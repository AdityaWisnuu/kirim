import { getStore } from "@netlify/blobs";

/// Ringkasan telemetri yang ditampilkan di halaman Monitoring.
export default async () => {
  const store = getStore("kirim-telemetry");
  const summary = (await store.get("summary", { type: "json" })) ?? {
    counts: {},
    daily: {},
    sessions: [],
    errors: [],
    updatedAt: null,
  };

  return Response.json(
    {
      counts: summary.counts,
      daily: summary.daily,
      sessionCount: summary.sessions?.length ?? 0,
      errors: summary.errors ?? [],
      updatedAt: summary.updatedAt,
    },
    { headers: { "cache-control": "public, max-age=15" } }
  );
};

export const config = { path: "/api/metrics" };
