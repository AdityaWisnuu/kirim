// Cetak sekumpulan tautan klaim di muka, lalu simpan sebagai kolam undangan.
//
// Alasannya ada di hasil uji beban: menulis ke rantai pada saat permintaan
// datang membuat sepuluh orang yang menekan tombol bersamaan saling menunggu
// sampai gateway menyerah. Dengan kolam ini, permintaan hanya mengambil satu
// tautan yang sudah jadi — tidak ada pekerjaan rantai di jalur permintaan.
//
// Pakai: node scripts/mint-pool.mjs [jumlah] [xlm_per_tautan]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
const sh = promisify(execFile);

const COUNT = Number(process.argv[2] ?? 30);
const XLM = Number(process.argv[3] ?? 2);
const CONTRACT = process.env.CONTRACT ?? "CBMSCY57EJZHLSGVEGLVKBP75KACEJCJPO7TFEQZOO6T6DYVJDZP3SMX";
const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const SOURCE = process.env.SOURCE ?? "onboarder";
const STELLAR = "/opt/homebrew/bin/stellar";

const stroops = String(Math.round(XLM * 10_000_000));
const sender = (await sh(STELLAR, ["keys", "address", SOURCE])).stdout.trim();

console.log(`Mencetak ${COUNT} tautan dari ${sender} (${XLM} XLM masing-masing)…`);

const pool = [];
for (let i = 0; i < COUNT; i++) {
  const secret = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(Buffer.from(secret, "hex")).digest("hex");

  const { stdout } = await sh(
    STELLAR,
    [
      "contract", "invoke", "--id", CONTRACT, "--source", SOURCE, "--network", "testnet",
      "--", "send", "--sender", sender, "--token", TOKEN, "--amount", stroops,
      "--memo", "welcome to KIRIM", "--ttl_ledgers", "120960", "--claim_hash", `"${hash}"`,
    ],
    { maxBuffer: 1024 * 1024 * 8 }
  );

  const id = Number(stdout.trim().split("\n").pop());
  pool.push({ id, secret });
  process.stdout.write(`\r  ${i + 1}/${COUNT} (id ${id})   `);
}

console.log("\n");
console.log(JSON.stringify({ pool }, null, 2).slice(0, 200) + "…");

// Diserahkan ke Netlify Blobs lewat endpoint terlindungi.
const endpoint = process.env.APP ?? "https://kirim-app.netlify.app";
const response = await fetch(`${endpoint}/api/invite`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    "x-pool-token": process.env.POOL_TOKEN ?? "",
  },
  body: JSON.stringify({ pool }),
});

console.log(response.ok ? "Kolam terpasang ✓" : `Gagal memasang kolam: ${response.status} ${await response.text()}`);
