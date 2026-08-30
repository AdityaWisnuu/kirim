// Stress test kontrak KIRIM di instance terpisah.
//
// Sengaja TIDAK menyentuh kontrak produksi: dompet sintetis akan mencemari
// metrik "unique wallets" di /monitor, dan uji beban yang jujur harus boleh
// didorong sampai ada yang patah.
//
// Pakai: node scripts/loadtest.mjs [jumlah_wallet]
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

const CONTRACT_ID = process.env.CONTRACT ?? "CAGJWCJQATJNBF3D7PWHDRADBJPYGDRBQNVFZHH7XCW7WOLAHMJPZ46K";
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON = "https://horizon-testnet.stellar.org";

const WALLETS = Number(process.argv[2] ?? 25);
const AMOUNT = 1_000_000n; // 0.1 XLM
const TTL = 17_280;

const server = new rpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

const now = () => Number(process.hrtime.bigint() / 1_000_000n);
const pct = (sorted, p) => sorted[Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1)];

async function fund(keypair) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
  if (!response.ok) throw new Error(`friendbot ${response.status}`);
  return keypair;
}

/// Satu transfer penuh dari satu dompet, diukur dari bangun sampai final.
async function sendOnce(keypair, recipient) {
  const started = now();
  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "send",
        nativeToScVal(keypair.publicKey(), { type: "address" }),
        nativeToScVal(recipient, { type: "address" }),
        nativeToScVal(XLM_SAC, { type: "address" }),
        nativeToScVal(AMOUNT, { type: "i128" }),
        nativeToScVal("loadtest", { type: "string" }),
        nativeToScVal(TTL, { type: "u32" }),
        xdr.ScVal.scvVoid()
      )
    )
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`submit: ${JSON.stringify(sent.errorResult)}`);

  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && result.status === "NOT_FOUND"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== "SUCCESS") throw new Error(`final: ${result.status}`);

  return { ms: now() - started, id: Number(scValToNative(result.returnValue)) };
}

console.log(`Contract : ${CONTRACT_ID}`);
console.log(`Wallets  : ${WALLETS}\n`);

console.log("1. Membuat & mendanai dompet…");
const fundStart = now();
const keypairs = Array.from({ length: WALLETS }, () => Keypair.random());
const funded = await Promise.allSettled(keypairs.map(fund));
const ready = keypairs.filter((_, i) => funded[i].status === "fulfilled");
console.log(`   ${ready.length}/${WALLETS} terdanai dalam ${((now() - fundStart) / 1000).toFixed(1)}s`);
if (funded.some((r) => r.status === "rejected")) {
  console.log(`   ${funded.filter((r) => r.status === "rejected").length} ditolak friendbot (rate limit)`);
}

console.log("\n2. Menembakkan transfer serentak…");
const burstStart = now();
const results = await Promise.allSettled(
  ready.map((keypair, i) => sendOnce(keypair, ready[(i + 1) % ready.length].publicKey()))
);
const wall = now() - burstStart;

const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
const failed = results.filter((r) => r.status === "rejected").map((r) => r.reason.message);
const latencies = ok.map((r) => r.ms).sort((a, b) => a - b);

console.log(`\n=== Hasil ===`);
console.log(`Sukses     : ${ok.length}/${ready.length}`);
console.log(`Gagal      : ${failed.length}`);
console.log(`Wall clock : ${(wall / 1000).toFixed(1)}s`);
console.log(`Throughput : ${(ok.length / (wall / 1000)).toFixed(2)} transfer/detik`);
if (latencies.length) {
  console.log(`Latensi    : p50 ${pct(latencies, 50)}ms · p95 ${pct(latencies, 95)}ms · max ${latencies.at(-1)}ms`);
}
if (failed.length) {
  const grouped = failed.reduce((acc, message) => {
    const key = message.slice(0, 90);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nKegagalan:`);
  for (const [message, count] of Object.entries(grouped)) console.log(`  ${count}× ${message}`);
}

const stats = scValToNative(
  (
    await server.simulateTransaction(
      new TransactionBuilder(await server.getAccount(ready[0].publicKey()), {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call("stats"))
        .setTimeout(30)
        .build()
    )
  ).result.retval
);
console.log(`\nStats kontrak: ${JSON.stringify(stats, (_, v) => (typeof v === "bigint" ? String(v) : v))}`);
