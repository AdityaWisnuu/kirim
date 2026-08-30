// Apa yang dialami pengguna kalau sepuluh orang menekan "Send me a test
// transfer" pada detik yang sama — skenario nyata saat tautan dibagikan ke grup.
import { Keypair } from "@stellar/stellar-sdk";

const APP = process.env.APP ?? "https://kirim-app.netlify.app";
const PEOPLE = Number(process.argv[2] ?? 10);

const addresses = Array.from({ length: PEOPLE }, () => Keypair.random().publicKey());
const started = Date.now();

const outcomes = await Promise.all(
  addresses.map(async (address, i) => {
    const t0 = Date.now();
    try {
      const response = await fetch(`${APP}/api/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const body = await response.json().catch(() => ({}));
      return { i, ms: Date.now() - t0, status: response.status, error: body?.error, id: body?.id };
    } catch (error) {
      return { i, ms: Date.now() - t0, status: 0, error: error.message };
    }
  })
);

const ok = outcomes.filter((o) => o.status === 200);
const bad = outcomes.filter((o) => o.status !== 200);

console.log(`${PEOPLE} orang menekan bersamaan · total ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
console.log(`Dapat transfer : ${ok.length}/${PEOPLE}`);
console.log(`Gagal          : ${bad.length}`);

const times = outcomes.map((o) => o.ms).sort((a, b) => a - b);
console.log(`Tunggu (detik) : tercepat ${(times[0] / 1000).toFixed(1)} · median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} · terlama ${(times.at(-1) / 1000).toFixed(1)}`);

if (bad.length) {
  console.log("\nYang dilihat pengguna yang gagal:");
  const grouped = bad.reduce((acc, o) => {
    const key = `${o.status}: ${o.error ?? "(tanpa pesan)"}`.slice(0, 100);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  for (const [message, count] of Object.entries(grouped)) console.log(`  ${count}× ${message}`);
}
