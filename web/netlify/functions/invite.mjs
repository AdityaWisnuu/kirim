import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

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

/// Slot ditentukan dari alamatnya sendiri, bukan dari antrean bersama: permintaan
/// yang datang bersamaan tidak saling berebut, dan permintaan ulang dari alamat
/// yang sama selalu mendapat tautan yang sama.
function slotFor(address, size) {
  const digest = createHash("sha256").update(address).digest();
  return digest.readUInt32BE(0) % size;
}

export default async (request) => {
  const store = getStore("kirim-invites");

  // Pengisian kolam oleh penyelenggara — pekerjaan rantai dilakukan di muka.
  if (request.method === "PUT") {
    const expected = process.env.POOL_TOKEN;
    if (!expected || request.headers.get("x-pool-token") !== expected) {
      return new Response("Forbidden", { status: 403 });
    }
    const { pool } = await request.json();
    if (!Array.isArray(pool) || pool.length === 0) {
      return new Response("Bad request", { status: 400 });
    }
    const existing = (await store.get("pool", { type: "json" })) ?? [];
    await store.setJSON("pool", [...existing, ...pool]);
    return Response.json({ ok: true, size: existing.length + pool.length });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
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

  const pool = (await store.get("pool", { type: "json" })) ?? [];
  if (pool.length === 0) {
    return Response.json(
      { error: "The test pool is empty right now — ping the author." },
      { status: 503 }
    );
  }

  const claims = (await store.get("claims", { type: "json" })) ?? {};
  let index = claims[address];

  if (index == null) {
    // Ambil slot milik alamat ini; kalau sudah dipakai orang lain, geser maju.
    index = slotFor(address, pool.length);
    const taken = new Set(Object.values(claims));
    for (let step = 0; step < pool.length && taken.has(index); step++) {
      index = (index + 1) % pool.length;
    }
    if (taken.has(index)) {
      return Response.json({ error: "Every test transfer is taken." }, { status: 503 });
    }
    claims[address] = index;
    await store.setJSON("claims", claims);
  }

  // Pendanaan akun tetap dilakukan per permintaan, tapi ini cepat dan aman
  // dijalankan berbarengan — tidak ada state kontrak yang diperebutkan.
  let accountState;
  try {
    accountState = await ensureAccountExists(address);
  } catch (error) {
    return Response.json(
      { error: `Couldn't prepare your account: ${error.message}` },
      { status: 502 }
    );
  }

  const entry = pool[index];
  return Response.json({ id: entry.id, secret: entry.secret, account: accountState });
};

export const config = { path: "/api/invite" };
