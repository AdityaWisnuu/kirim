import { getStore } from "@netlify/blobs";

const MAX_ERRORS = 50;

/// Terima batch event telemetri dan rangkum jadi penghitung harian.
/// Tidak ada cookie, tidak ada IP, tidak ada pihak ketiga.
export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const events = Array.isArray(payload?.events) ? payload.events.slice(0, 20) : [];
  if (events.length === 0) return Response.json({ ok: true, counted: 0 });

  const store = getStore("kirim-telemetry");
  const current = (await store.get("summary", { type: "json" })) ?? {
    counts: {},
    daily: {},
    sessions: [],
    errors: [],
    updatedAt: null,
  };

  const today = new Date().toISOString().slice(0, 10);
  current.daily[today] ??= {};

  for (const event of events) {
    const name = String(event?.name ?? "unknown").slice(0, 40);
    current.counts[name] = (current.counts[name] ?? 0) + 1;
    current.daily[today][name] = (current.daily[today][name] ?? 0) + 1;

    const session = String(event?.session ?? "").slice(0, 40);
    if (session && !current.sessions.includes(session)) {
      current.sessions.push(session);
      // Jaga daftar sesi tetap ringkas; yang dibutuhkan hanya jumlahnya.
      if (current.sessions.length > 500) current.sessions.shift();
    }

    if (name === "client_error") {
      current.errors.unshift({
        message: String(event?.props?.message ?? "").slice(0, 300),
        source: String(event?.props?.source ?? "").slice(0, 20),
        at: event?.at ?? new Date().toISOString(),
      });
      current.errors = current.errors.slice(0, MAX_ERRORS);
    }
  }

  // Simpan riwayat harian 30 hari terakhir saja.
  const days = Object.keys(current.daily).sort();
  for (const day of days.slice(0, Math.max(days.length - 30, 0))) {
    delete current.daily[day];
  }

  current.updatedAt = new Date().toISOString();
  await store.setJSON("summary", current);

  return Response.json({ ok: true, counted: events.length });
};

export const config = { path: "/api/track" };
