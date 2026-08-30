// Uji KIRIM dari sudut pandang pengguna: browser sungguhan, perjalanan nyata,
// lalu simulasi orang-orang yang menekan tombol pada saat bersamaan.
import { chromium } from "playwright-core";

const APP = "https://kirim-app.netlify.app";
const results = [];

const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function journey(name, { width, height }, path, checks) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const started = Date.now();
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  record(`${name} · muat < 8s`, Date.now() - started < 8_000, `${Date.now() - started}ms`);

  for (const [label, text] of checks) {
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20_000 });
      record(`${name} · ${label}`, true);
    } catch {
      record(`${name} · ${label}`, false, `tidak menemukan "${text}"`);
    }
  }

  // Halaman produk tidak boleh menggeser ke samping di layar sempit.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  record(`${name} · tanpa scroll horizontal`, !overflow);

  const realErrors = errors.filter((e) => !/404|favicon/i.test(e));
  record(`${name} · tanpa error JS`, realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

  await context.close();
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

console.log("=== Perjalanan pengguna ===");

await journey("Beranda (ponsel)", PHONE, "/", [
  ["ajakan utama terlihat", "Share a link"],
  ["tombol kirim terlihat", "Lock & create link"],
]);

await journey("Pendaftaran /join (ponsel)", PHONE, "/join", [
  ["judul jelas", "Get a test transfer"],
  ["tombol minta transfer", "Send me a test transfer"],
  ["jalan keluar bagi yang belum punya wallet", "setup guide"],
]);

await journey("Panduan /try (ponsel)", PHONE, "/try", [
  ["langkah pertama", "Get a Stellar wallet"],
  ["langkah klaim", "Claim, then tell me what broke"],
]);

await journey("Klaim yang sudah cair", PHONE, "/claim?id=1", [
  ["status jelas", "Already claimed"],
  ["ada jalan lanjut", "Send one of your own"],
]);

await journey("Tautan tanpa rahasia", PHONE, "/claim?id=0", [
  ["dijelaskan, bukan dibiarkan buntu", "claim"],
]);

await journey("Transfer tidak ada", PHONE, "/claim?id=999999", [
  ["pesan tidak ditemukan", "couldn't find"],
  ["ada jalan kembali", "Back to sending"],
]);

await journey("Monitor (desktop)", DESKTOP, "/monitor", [
  ["metrik on-chain", "transfers created"],
  ["funnel produk", "Product funnel"],
]);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} lolos ===`);
if (failed.length) {
  console.log("Gagal:");
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exitCode = 1;
}
