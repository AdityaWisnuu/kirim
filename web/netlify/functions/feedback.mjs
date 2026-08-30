import { getStore } from "@netlify/blobs";

const MAX_STORED = 200;

/// Kumpulkan masukan pengguna langsung di dalam aplikasi, lalu tampilkan
/// rekapnya di halaman Monitoring supaya lingkaran umpan baliknya terlihat.
export default async (request) => {
  const store = getStore("kirim-feedback");

  if (request.method === "GET") {
    const entries = (await store.get("entries", { type: "json" })) ?? [];
    const ratings = entries.map((e) => e.rating).filter((r) => typeof r === "number");
    const average = ratings.length
      ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
      : null;

    return Response.json({
      total: entries.length,
      averageRating: average,
      breakdown: [1, 2, 3, 4, 5].map((score) => ({
        score,
        count: ratings.filter((r) => r === score).length,
      })),
      // Hanya potongan komentar yang ditampilkan publik.
      recent: entries.slice(0, 20).map((entry) => ({
        rating: entry.rating,
        comment: entry.comment,
        role: entry.role,
        at: entry.at,
      })),
    });
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

  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return new Response("Rating must be 1-5", { status: 400 });
  }

  const entry = {
    rating,
    comment: String(body?.comment ?? "").slice(0, 500),
    role: String(body?.role ?? "").slice(0, 40),
    wallet: String(body?.wallet ?? "").slice(0, 60),
    at: new Date().toISOString(),
  };

  const entries = (await store.get("entries", { type: "json" })) ?? [];
  entries.unshift(entry);
  await store.setJSON("entries", entries.slice(0, MAX_STORED));

  return Response.json({ ok: true });
};

export const config = { path: "/api/feedback" };
