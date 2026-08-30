/// Telemetri ringan tanpa cookie dan tanpa pihak ketiga.
/// Event dikirim ke fungsi Netlify milik sendiri; kalau gagal, dibuang diam-diam
/// supaya kegagalan pemantauan tidak pernah merusak aplikasi.

const ENDPOINT = "/api/track";
const SESSION_KEY = "kirim:session";
const queue = [];
let flushing = false;

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch {
    // Telemetri tidak pernah diulang; kehilangan satu batch tidak masalah.
  } finally {
    flushing = false;
    if (queue.length > 0) setTimeout(flush, 1_000);
  }
}

export function track(name, props = {}) {
  queue.push({ name, props, session: sessionId(), at: new Date().toISOString() });
  if (queue.length >= 5) flush();
  else setTimeout(flush, 800);
}

export function trackPageView(path) {
  track("page_view", { path });
}

/// Tangkap kegagalan yang lolos ke tepi aplikasi agar terlihat di /stats.
export function installErrorTracking(onError) {
  const report = (message, source) => {
    track("client_error", { message: String(message).slice(0, 300), source });
    onError?.(message);
  };

  window.addEventListener("error", (event) => {
    report(event.message || "Unknown error", "window");
  });
  window.addEventListener("unhandledrejection", (event) => {
    report(event.reason?.message ?? event.reason ?? "Unhandled rejection", "promise");
  });
}

export async function fetchMetrics() {
  const response = await fetch("/api/metrics");
  if (!response.ok) throw new Error(`metrics ${response.status}`);
  return response.json();
}

export async function submitFeedback(payload) {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`feedback ${response.status}`);
  return response.json();
}

export async function fetchFeedback() {
  const response = await fetch("/api/feedback");
  if (!response.ok) throw new Error(`feedback ${response.status}`);
  return response.json();
}
