#![no_std]
//! KIRIM — protected money transfers on Stellar.
//!
//! Dana dikunci di escrow, bukan dilempar langsung ke alamat. Ada dua mode:
//!
//! * **Direct** — `recipient = Some(addr)`; hanya alamat itu yang bisa claim.
//! * **Link** — `recipient = None` + `claim_hash = sha256(secret)`; siapa pun yang
//!   memegang secret bisa claim ke alamatnya sendiri, jadi penerima tidak perlu
//!   punya wallet sebelum uang dikirim.
//!
//! Lewat batas waktu, pengirim menarik dananya kembali. Setiap perubahan status
//! memancarkan event supaya klien bisa sinkron real-time.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Bytes,
    BytesN, Env, String, Vec,
};

// ---------------------------------------------------------------- tipe data

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending = 0,
    Claimed = 1,
    Refunded = 2,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Transfer {
    pub id: u64,
    pub sender: Address,
    /// `None` berarti transfer mode link — ditebus dengan secret.
    pub recipient: Option<Address>,
    pub token: Address,
    /// Jumlah bersih yang diterima penerima (fee sudah dipotong).
    pub amount: i128,
    /// Biaya protokol yang ditahan saat claim.
    pub fee: i128,
    pub memo: String,
    pub created_ledger: u32,
    pub expiry_ledger: u32,
    pub claim_hash: Option<BytesN<32>>,
    pub status: Status,
    pub claimed_by: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Stats {
    pub total_transfers: u64,
    pub claimed: u64,
    pub refunded: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Treasury,
    FeeBps,
    Count,
    Claimed,
    Refunded,
    Transfer(u64),
    /// Riwayat transfer yang dikirim satu alamat.
    Sent(Address),
    /// Riwayat transfer yang ditujukan/diklaim satu alamat.
    Received(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    InvalidAmount = 1,
    InvalidTtl = 2,
    NotFound = 3,
    NotPending = 4,
    Expired = 5,
    NotExpiredYet = 6,
    Unauthorized = 7,
    InvalidSecret = 8,
    SecretRequired = 9,
    MemoTooLong = 10,
    InvalidFee = 11,
    SelfTransfer = 12,
    ClaimTargetRequired = 13,
}

// ~5 detik per ledger: jendela klaim 1 menit s.d. ±30 hari.
const MIN_TTL_LEDGERS: u32 = 12;
const MAX_TTL_LEDGERS: u32 = 518_400;
// Umur storage transfer aktif ±60 hari, diperpanjang tiap kali disentuh.
const STORAGE_TTL: u32 = 1_036_800;
const MAX_MEMO_BYTES: u32 = 140;
/// Batas atas biaya protokol: 2% — dikunci di kontrak, admin tidak bisa melewatinya.
const MAX_FEE_BPS: u32 = 200;
const BPS_DENOM: i128 = 10_000;

#[contract]
pub struct Kirim;

#[contractimpl]
impl Kirim {
    pub fn __constructor(env: Env, admin: Address, treasury: Address, fee_bps: u32) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Treasury, &treasury);
        s.set(&DataKey::FeeBps, &fee_bps.min(MAX_FEE_BPS));
        s.set(&DataKey::Count, &0u64);
        s.set(&DataKey::Claimed, &0u64);
        s.set(&DataKey::Refunded, &0u64);
    }

    /// Kunci dana untuk penerima tertentu (`recipient = Some`) atau untuk
    /// siapa pun yang memegang secret dari `claim_hash` (`recipient = None`).
    #[allow(clippy::too_many_arguments)]
    pub fn send(
        env: Env,
        sender: Address,
        recipient: Option<Address>,
        token: Address,
        amount: i128,
        memo: String,
        ttl_ledgers: u32,
        claim_hash: Option<BytesN<32>>,
    ) -> Result<u64, Error> {
        sender.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if !(MIN_TTL_LEDGERS..=MAX_TTL_LEDGERS).contains(&ttl_ledgers) {
            return Err(Error::InvalidTtl);
        }
        if memo.len() > MAX_MEMO_BYTES {
            return Err(Error::MemoTooLong);
        }
        match &recipient {
            Some(to) if *to == sender => return Err(Error::SelfTransfer),
            // Tanpa penerima tetap, harus ada hash secret — kalau tidak dana
            // akan bisa diambil siapa saja.
            None if claim_hash.is_none() => return Err(Error::SecretRequired),
            _ => {}
        }

        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap();
        let fee = amount * i128::from(fee_bps) / BPS_DENOM;
        let net = amount - fee;

        // Escrow memegang dana sampai diklaim atau dikembalikan.
        token::Client::new(&env, &token).transfer(
            &sender,
            &env.current_contract_address(),
            &amount,
        );

        let id: u64 = env.storage().instance().get(&DataKey::Count).unwrap();
        let now = env.ledger().sequence();
        let transfer = Transfer {
            id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token,
            amount: net,
            fee,
            memo,
            created_ledger: now,
            expiry_ledger: now + ttl_ledgers,
            claim_hash,
            status: Status::Pending,
            claimed_by: None,
        };
        write_transfer(&env, &transfer);
        env.storage().instance().set(&DataKey::Count, &(id + 1));

        push_index(&env, DataKey::Sent(sender.clone()), id);
        if let Some(to) = &recipient {
            push_index(&env, DataKey::Received(to.clone()), id);
        }

        env.events().publish(
            (symbol_short!("kirim"), symbol_short!("sent"), id),
            (sender, recipient, net),
        );
        Ok(id)
    }

    /// Tarik dana. Mode direct: `claimer` harus penerima yang tercatat.
    /// Mode link: `claimer` bebas, asal `secret` cocok dengan `claim_hash`.
    pub fn claim(env: Env, id: u64, claimer: Address, secret: Option<Bytes>) -> Result<(), Error> {
        claimer.require_auth();

        let mut t = read_transfer(&env, id)?;
        if t.status != Status::Pending {
            return Err(Error::NotPending);
        }
        if env.ledger().sequence() > t.expiry_ledger {
            return Err(Error::Expired);
        }

        match (&t.recipient, &t.claim_hash) {
            // Mode direct: alamat penerima yang mengunci akses.
            (Some(to), _) => {
                if *to != claimer {
                    return Err(Error::Unauthorized);
                }
            }
            // Mode link: secret yang mengunci akses.
            (None, Some(hash)) => {
                let provided = secret.ok_or(Error::SecretRequired)?;
                if env.crypto().sha256(&provided).to_bytes() != *hash {
                    return Err(Error::InvalidSecret);
                }
            }
            (None, None) => return Err(Error::ClaimTargetRequired),
        }

        let token_client = token::Client::new(&env, &t.token);
        token_client.transfer(&env.current_contract_address(), &claimer, &t.amount);
        if t.fee > 0 {
            let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
            token_client.transfer(&env.current_contract_address(), &treasury, &t.fee);
        }

        t.status = Status::Claimed;
        t.claimed_by = Some(claimer.clone());
        write_transfer(&env, &t);
        bump_counter(&env, DataKey::Claimed);
        if t.recipient.is_none() {
            push_index(&env, DataKey::Received(claimer.clone()), id);
        }

        env.events().publish(
            (symbol_short!("kirim"), symbol_short!("claimed"), id),
            (claimer, t.amount),
        );
        Ok(())
    }

    /// Kembalikan dana ke pengirim setelah jendela klaim tutup.
    pub fn refund(env: Env, id: u64) -> Result<(), Error> {
        let mut t = read_transfer(&env, id)?;
        t.sender.require_auth();

        if t.status != Status::Pending {
            return Err(Error::NotPending);
        }
        if env.ledger().sequence() <= t.expiry_ledger {
            return Err(Error::NotExpiredYet);
        }

        // Refund mengembalikan nilai penuh — fee hanya berlaku untuk klaim sukses.
        token::Client::new(&env, &t.token).transfer(
            &env.current_contract_address(),
            &t.sender,
            &(t.amount + t.fee),
        );

        t.status = Status::Refunded;
        write_transfer(&env, &t);
        bump_counter(&env, DataKey::Refunded);

        env.events().publish(
            (symbol_short!("kirim"), symbol_short!("refunded"), id),
            (t.sender.clone(), t.amount + t.fee),
        );
        Ok(())
    }

    // ------------------------------------------------------------- pembacaan

    pub fn get_transfer(env: Env, id: u64) -> Result<Transfer, Error> {
        read_transfer(&env, id)
    }

    pub fn sent_by(env: Env, who: Address) -> Vec<u64> {
        read_index(&env, DataKey::Sent(who))
    }

    pub fn received_by(env: Env, who: Address) -> Vec<u64> {
        read_index(&env, DataKey::Received(who))
    }

    pub fn stats(env: Env) -> Stats {
        let s = env.storage().instance();
        Stats {
            total_transfers: s.get(&DataKey::Count).unwrap_or(0),
            claimed: s.get(&DataKey::Claimed).unwrap_or(0),
            refunded: s.get(&DataKey::Refunded).unwrap_or(0),
        }
    }

    pub fn fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap()
    }

    // --------------------------------------------------------------- admin

    pub fn set_fee(env: Env, bps: u32) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        env.storage().instance().set(&DataKey::FeeBps, &bps);
        Ok(())
    }
}

// ------------------------------------------------------------------ helper

fn write_transfer(env: &Env, t: &Transfer) {
    let key = DataKey::Transfer(t.id);
    let store = env.storage().persistent();
    store.set(&key, t);
    store.extend_ttl(&key, STORAGE_TTL, STORAGE_TTL);
}

fn read_transfer(env: &Env, id: u64) -> Result<Transfer, Error> {
    let key = DataKey::Transfer(id);
    let store = env.storage().persistent();
    let t: Transfer = store.get(&key).ok_or(Error::NotFound)?;
    store.extend_ttl(&key, STORAGE_TTL, STORAGE_TTL);
    Ok(t)
}

fn push_index(env: &Env, key: DataKey, id: u64) {
    let store = env.storage().persistent();
    let mut list: Vec<u64> = store.get(&key).unwrap_or(Vec::new(env));
    list.push_back(id);
    store.set(&key, &list);
    store.extend_ttl(&key, STORAGE_TTL, STORAGE_TTL);
}

fn read_index(env: &Env, key: DataKey) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env))
}

fn bump_counter(env: &Env, key: DataKey) {
    let s = env.storage().instance();
    let n: u64 = s.get(&key).unwrap_or(0);
    s.set(&key, &(n + 1));
}

mod test;
