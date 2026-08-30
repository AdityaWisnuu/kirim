#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, Env, String,
};

const XLM: i128 = 10_000_000;

struct Ctx<'a> {
    env: Env,
    kirim: KirimClient<'a>,
    token: TokenClient<'a>,
    token_id: Address,
    sender: Address,
    recipient: Address,
    treasury: Address,
    admin: Address,
}

/// Kontrak dengan biaya protokol `fee_bps` dan dua akun terdanai.
fn ctx_with_fee(fee_bps: u32) -> Ctx<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let asset = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token_id = asset.address();
    let token = TokenClient::new(&env, &token_id);
    StellarAssetClient::new(&env, &token_id).mint(&sender, &(1_000 * XLM));

    let contract_id = env.register(Kirim, (&admin, &treasury, fee_bps));
    let kirim = KirimClient::new(&env, &contract_id);

    Ctx { env, kirim, token, token_id, sender, recipient, treasury, admin }
}

fn ctx() -> Ctx<'static> {
    ctx_with_fee(0)
}

fn memo(env: &Env) -> String {
    String::from_str(env, "buat keluarga di rumah")
}

/// `send` mode direct.
fn send_direct(c: &Ctx, amount: i128, ttl: u32) -> u64 {
    c.kirim.send(
        &c.sender,
        &Some(c.recipient.clone()),
        &c.token_id,
        &amount,
        &memo(&c.env),
        &ttl,
        &None,
    )
}

/// `send` mode link, dikunci dengan sha256(secret).
fn send_link(c: &Ctx, amount: i128, ttl: u32, secret: &Bytes) -> u64 {
    let hash = c.env.crypto().sha256(secret).to_bytes();
    c.kirim.send(
        &c.sender,
        &None,
        &c.token_id,
        &amount,
        &memo(&c.env),
        &ttl,
        &Some(hash),
    )
}

fn secret_of(env: &Env) -> Bytes {
    Bytes::from_array(env, &[7u8; 32])
}

// ------------------------------------------------------------- mode direct

#[test]
fn direct_transfer_locks_then_releases_to_recipient() {
    let c = ctx();
    let id = send_direct(&c, 250 * XLM, 100);

    assert_eq!(id, 0);
    assert_eq!(c.token.balance(&c.sender), 750 * XLM);
    assert_eq!(c.token.balance(&c.kirim.address), 250 * XLM);

    c.kirim.claim(&id, &c.recipient, &None);

    assert_eq!(c.token.balance(&c.recipient), 250 * XLM);
    assert_eq!(c.token.balance(&c.kirim.address), 0);

    let t = c.kirim.get_transfer(&id);
    assert_eq!(t.status, Status::Claimed);
    assert_eq!(t.claimed_by, Some(c.recipient.clone()));
}

#[test]
fn only_the_named_recipient_can_claim_a_direct_transfer() {
    let c = ctx();
    let id = send_direct(&c, 10 * XLM, 100);
    let intruder = Address::generate(&c.env);

    assert_eq!(
        c.kirim.try_claim(&id, &intruder, &None),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(c.token.balance(&intruder), 0);
}

// --------------------------------------------------------------- mode link

#[test]
fn link_transfer_pays_whoever_presents_the_secret() {
    let c = ctx();
    let secret = secret_of(&c.env);
    let id = send_link(&c, 40 * XLM, 100, &secret);

    // Penerima belum dikenal saat dana dikirim — wallet dibuat belakangan.
    let late_wallet = Address::generate(&c.env);
    c.kirim.claim(&id, &late_wallet, &Some(secret));

    assert_eq!(c.token.balance(&late_wallet), 40 * XLM);
    let t = c.kirim.get_transfer(&id);
    assert_eq!(t.claimed_by, Some(late_wallet.clone()));
    // Klaim mode link ikut tercatat di riwayat penerima.
    assert_eq!(c.kirim.received_by(&late_wallet).len(), 1);
}

#[test]
fn link_transfer_rejects_a_wrong_secret() {
    let c = ctx();
    let id = send_link(&c, 40 * XLM, 100, &secret_of(&c.env));
    let stranger = Address::generate(&c.env);
    let wrong = Bytes::from_array(&c.env, &[9u8; 32]);

    assert_eq!(
        c.kirim.try_claim(&id, &stranger, &Some(wrong)),
        Err(Ok(Error::InvalidSecret))
    );
    assert_eq!(
        c.kirim.try_claim(&id, &stranger, &None),
        Err(Ok(Error::SecretRequired))
    );
    assert_eq!(c.token.balance(&stranger), 0);
}

#[test]
fn a_link_transfer_without_a_hash_is_rejected_at_send() {
    let c = ctx();
    let res = c.kirim.try_send(
        &c.sender,
        &None,
        &c.token_id,
        &(10 * XLM),
        &memo(&c.env),
        &100,
        &None,
    );
    assert_eq!(res, Err(Ok(Error::SecretRequired)));
}

// ------------------------------------------------------------- masa berlaku

#[test]
fn refund_returns_the_full_amount_after_expiry() {
    let c = ctx_with_fee(100); // 1%
    let id = send_direct(&c, 100 * XLM, 50);
    c.env.ledger().with_mut(|l| l.sequence_number += 51);

    c.kirim.refund(&id);

    // Refund mengembalikan nominal penuh, termasuk bagian fee.
    assert_eq!(c.token.balance(&c.sender), 1_000 * XLM);
    assert_eq!(c.token.balance(&c.treasury), 0);
    assert_eq!(c.kirim.get_transfer(&id).status, Status::Refunded);
}

#[test]
fn claiming_after_expiry_is_rejected() {
    let c = ctx();
    let id = send_direct(&c, 10 * XLM, 50);
    c.env.ledger().with_mut(|l| l.sequence_number += 51);

    assert_eq!(
        c.kirim.try_claim(&id, &c.recipient, &None),
        Err(Ok(Error::Expired))
    );
}

#[test]
fn refunding_before_expiry_is_rejected() {
    let c = ctx();
    let id = send_direct(&c, 10 * XLM, 50);
    assert_eq!(c.kirim.try_refund(&id), Err(Ok(Error::NotExpiredYet)));
}

#[test]
fn a_transfer_can_only_settle_once() {
    let c = ctx();
    let id = send_direct(&c, 10 * XLM, 100);
    c.kirim.claim(&id, &c.recipient, &None);

    assert_eq!(
        c.kirim.try_claim(&id, &c.recipient, &None),
        Err(Ok(Error::NotPending))
    );
    c.env.ledger().with_mut(|l| l.sequence_number += 200);
    assert_eq!(c.kirim.try_refund(&id), Err(Ok(Error::NotPending)));
}

// -------------------------------------------------------------- biaya protokol

#[test]
fn the_protocol_fee_is_taken_from_the_claim_not_the_sender() {
    let c = ctx_with_fee(100); // 1%
    let id = send_direct(&c, 100 * XLM, 100);

    // Pengirim membayar nominal penuh di muka.
    assert_eq!(c.token.balance(&c.sender), 900 * XLM);

    c.kirim.claim(&id, &c.recipient, &None);

    assert_eq!(c.token.balance(&c.recipient), 99 * XLM);
    assert_eq!(c.token.balance(&c.treasury), 1 * XLM);
    assert_eq!(c.token.balance(&c.kirim.address), 0);
}

#[test]
fn the_fee_is_configurable_but_capped() {
    let c = ctx_with_fee(0);
    assert_eq!(c.kirim.fee_bps(), 0);

    c.kirim.set_fee(&150);
    assert_eq!(c.kirim.fee_bps(), 150);

    assert_eq!(c.kirim.try_set_fee(&5_000), Err(Ok(Error::InvalidFee)));
    assert_eq!(c.kirim.fee_bps(), 150);

    // Konstruktor pun tidak bisa melewati batas.
    let over = ctx_with_fee(9_999);
    assert_eq!(over.kirim.fee_bps(), 200);
    let _ = c.admin;
}

// ------------------------------------------------------ validasi & riwayat

#[test]
fn invalid_inputs_are_rejected() {
    let c = ctx();
    let to = Some(c.recipient.clone());

    assert_eq!(
        c.kirim.try_send(&c.sender, &to, &c.token_id, &0, &memo(&c.env), &100, &None),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        c.kirim.try_send(&c.sender, &to, &c.token_id, &XLM, &memo(&c.env), &1, &None),
        Err(Ok(Error::InvalidTtl))
    );
    assert_eq!(
        c.kirim.try_send(
            &c.sender,
            &Some(c.sender.clone()),
            &c.token_id,
            &XLM,
            &memo(&c.env),
            &100,
            &None
        ),
        Err(Ok(Error::SelfTransfer))
    );
    assert_eq!(c.kirim.try_get_transfer(&404), Err(Ok(Error::NotFound)));
}

#[test]
fn an_overlong_memo_is_rejected() {
    let c = ctx();
    let long = String::from_str(
        &c.env,
        "0123456789012345678901234567890123456789012345678901234567890123456789\
         0123456789012345678901234567890123456789012345678901234567890123456789x",
    );
    let res = c.kirim.try_send(
        &c.sender,
        &Some(c.recipient.clone()),
        &c.token_id,
        &XLM,
        &long,
        &100,
        &None,
    );
    assert_eq!(res, Err(Ok(Error::MemoTooLong)));
}

#[test]
fn history_and_stats_track_every_transfer() {
    let c = ctx();
    let a = send_direct(&c, 10 * XLM, 100);
    let b = send_direct(&c, 20 * XLM, 50);

    assert_eq!(c.kirim.sent_by(&c.sender).len(), 2);
    assert_eq!(c.kirim.received_by(&c.recipient).len(), 2);

    c.kirim.claim(&a, &c.recipient, &None);
    c.env.ledger().with_mut(|l| l.sequence_number += 51);
    c.kirim.refund(&b);

    let s = c.kirim.stats();
    assert_eq!(s.total_transfers, 2);
    assert_eq!(s.claimed, 1);
    assert_eq!(s.refunded, 1);
}

#[test]
fn transfers_carry_their_own_token_so_several_assets_coexist() {
    let c = ctx();

    // Aset kedua, terpisah dari aset default milik ctx.
    let other = c.env.register_stellar_asset_contract_v2(Address::generate(&c.env));
    let other_id = other.address();
    StellarAssetClient::new(&c.env, &other_id).mint(&c.sender, &(500 * XLM));
    let other_token = TokenClient::new(&c.env, &other_id);

    let first = send_direct(&c, 10 * XLM, 100);
    let second = c.kirim.send(
        &c.sender,
        &Some(c.recipient.clone()),
        &other_id,
        &(25 * XLM),
        &memo(&c.env),
        &100,
        &None,
    );

    c.kirim.claim(&first, &c.recipient, &None);
    c.kirim.claim(&second, &c.recipient, &None);

    assert_eq!(c.token.balance(&c.recipient), 10 * XLM);
    assert_eq!(other_token.balance(&c.recipient), 25 * XLM);
    assert_eq!(c.kirim.get_transfer(&second).token, other_id);
}
