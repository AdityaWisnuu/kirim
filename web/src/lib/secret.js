/// Rahasia klaim: 32 byte acak yang hanya hidup di dalam tautan.
/// Kontrak hanya menyimpan sha256-nya, jadi memegang tautan = memegang uangnya.

export function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  const clean = String(hex).trim().replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("Malformed claim secret");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function sha256Hex(hex) {
  const digest = await crypto.subtle.digest("SHA-256", hexToBytes(hex));
  return bytesToHex(new Uint8Array(digest));
}

/// Rahasia dititipkan di fragment URL supaya tidak pernah ikut terkirim
/// ke server mana pun — termasuk log CDN yang menyajikan halaman ini.
export function buildClaimLink(origin, id, secret) {
  return `${origin}/claim?id=${id}#s=${secret}`;
}

export function readSecretFromLocation(location) {
  const fragment = (location.hash || "").replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  return params.get("s");
}
