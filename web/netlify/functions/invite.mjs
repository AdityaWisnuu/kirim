import { getStore } from "@netlify/blobs";
import {
  rpc,
  Contract,
  TransactionBuilder,
  Networks,
  Keypair,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const CONTRACT_ID = "CBMSCY57EJZHLSGVEGLVKBP75KACEJCJPO7TFEQZOO6T6DYVJDZP3SMX";
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const RPC_URL = "https://soroban-testnet.stellar.org";

/// 2 XLM testnet per pencoba, jendela klaim 7 hari.
const AMOUNT_STROOPS = 20_000_000n;
const TTL_LEDGERS = 120_960;
/// Batas kasar supaya faucet tidak dikuras satu orang atau bot.
const MAX_INVITES = 200;

const HORIZON_URL = "https://horizon-testnet.stellar.org";

const isStellarAddress = (value) => /^G[A-Z2-7]{55}$/.test(String(value ?? ""));

/// Dompet yang baru dibuat belum ada di ledger, dan akun yang belum ada tidak
/// bisa menerima aset apa pun. Danai lebih dulu supaya pencoba tidak menabrak
/// "Account not found" pada langkah pertamanya.
async function ensureAccountExists(address) {
  const existing = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (existing.ok) return "existing";
  if (existing.status !== 404) throw new Error(`Horizon ${existing.status}`);

  const funded = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  if (!funded.ok) throw new Error("Testnet faucet declined to create the account");
  return "created";
}

/// Kirim satu transfer percobaan ke alamat yang meminta, lalu kembalikan id-nya
/// supaya pemohon tinggal membuka halaman klaim dan menandatangani sendiri.
export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = process.env.ONBOARDER_SECRET;
  if (!secret) {
    return Response.json({ error: "Onboarding is not configured." }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const address = String(body?.address ?? "").trim();
  if (!isStellarAddress(address)) {
    return Response.json({ error: "That doesn't look like a Stellar address." }, { status: 400 });
  }

  const store = getStore("kirim-invites");
  const ledger = (await store.get("issued", { type: "json" })) ?? { total: 0, byAddress: {} };

  // Satu undangan per dompet — pengulangan dikembalikan ke transfer yang sama.
  if (ledger.byAddress[address] != null) {
    return Response.json({ id: ledger.byAddress[address], repeat: true });
  }
  if (ledger.total >= MAX_INVITES) {
    return Response.json(
      { error: "The test faucet is empty for now — ping the author." },
      { status: 429 }
    );
  }

  const keypair = Keypair.fromSecret(secret);
  if (keypair.publicKey() === address) {
    return Response.json({ error: "That's the faucet's own address." }, { status: 400 });
  }

  let accountState;
  try {
    accountState = await ensureAccountExists(address);
  } catch (error) {
    return Response.json(
      { error: `Couldn't prepare your account: ${error.message}` },
      { status: 502 }
    );
  }

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(keypair.publicKey());

  const operation = contract.call(
    "send",
    nativeToScVal(keypair.publicKey(), { type: "address" }),
    nativeToScVal(address, { type: "address" }), // Option::Some = nilainya langsung
    nativeToScVal(XLM_SAC, { type: "address" }),
    nativeToScVal(AMOUNT_STROOPS, { type: "i128" }),
    nativeToScVal("welcome to KIRIM 🧧", { type: "string" }),
    nativeToScVal(TTL_LEDGERS, { type: "u32" }),
    xdr.ScVal.scvVoid() // Option::None — mode direct, bukan tautan rahasia
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(120)
    .build();

  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (error) {
    return Response.json({ error: `Simulation failed: ${error.message}` }, { status: 502 });
  }

  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    return Response.json({ error: "The network rejected the transfer." }, { status: 502 });
  }

  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && result.status === "NOT_FOUND"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== "SUCCESS") {
    return Response.json({ error: `Transfer ${result.status}.` }, { status: 502 });
  }

  const id = Number(scValToNative(result.returnValue));
  ledger.byAddress[address] = id;
  ledger.total += 1;
  await store.setJSON("issued", ledger);

  return Response.json({ id, hash: sent.hash, account: accountState });
};

export const config = { path: "/api/invite" };
