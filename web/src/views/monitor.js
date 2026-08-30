import { CONTRACT_ID, EXPLORER } from "../lib/config.js";
import { getStats, recentEvents } from "../lib/chain.js";
import { fetchMetrics, fetchFeedback } from "../lib/analytics.js";
import { formatAmount, shortAddress } from "../lib/format.js";

/// Satu halaman untuk pertanyaan "apakah produk ini hidup dan sehat?":
/// kebenaran on-chain, telemetri aplikasi, kesalahan klien, dan suara pengguna.
export async function renderMonitor({ mount }) {
  mount.innerHTML = `
    <div class="enter">
      <div>
        <h1>Monitor</h1>
        <p class="lede">
          On-chain truth, product telemetry, client errors and user feedback — the same
          dashboard we use to decide what to fix next.
        </p>
      </div>

      <div class="panel">
        <h2>On-chain</h2>
        <div class="metrics" id="chain-metrics">${skeletonMetrics(4)}</div>
      </div>

      <div class="panel">
        <h2>Product funnel</h2>
        <div id="funnel"><div class="skeleton skeleton-line" style="width:70%"></div></div>
      </div>

      <div class="panel">
        <h2>User feedback</h2>
        <div id="feedback"><div class="skeleton skeleton-line" style="width:60%"></div></div>
      </div>

      <div class="panel">
        <h2>Client errors</h2>
        <div id="errors"><div class="skeleton skeleton-line" style="width:45%"></div></div>
      </div>
    </div>`;

  loadChain(mount);
  loadTelemetry(mount);
  loadFeedback(mount);
}

async function loadChain(mount) {
  const host = mount.querySelector("#chain-metrics");
  try {
    const [stats, events] = await Promise.all([getStats(), recentEvents(100)]);

    // Volume dan dompet unik diturunkan dari event, bukan diklaim sepihak.
    let volume = 0n;
    const wallets = new Set();
    for (const event of events) {
      if (event.action === "sent") {
        volume += BigInt(event.data[2]);
        wallets.add(String(event.data[0]));
      } else {
        wallets.add(String(event.data[0]));
      }
    }

    const total = Number(stats.total_transfers);
    const claimed = Number(stats.claimed);
    const settleRate = total ? Math.round((claimed / total) * 100) : 0;

    host.innerHTML = [
      metric(total, "transfers created"),
      metric(claimed, "claimed", true),
      metric(`${settleRate}%`, "claim rate"),
      metric(wallets.size, "unique wallets"),
    ].join("");

    mount.querySelector("#chain-extra")?.remove();
    host.insertAdjacentHTML(
      "afterend",
      `<p class="muted small" id="chain-extra" style="margin:12px 0 0">
         ${formatAmount(volume)} XLM moved through
         <a href="${EXPLORER}/contract/${CONTRACT_ID}" target="_blank" rel="noreferrer">${shortAddress(CONTRACT_ID, 6, 6)}</a>
         in the recent window · ${Number(stats.refunded)} refunded.
       </p>`
    );
  } catch {
    host.innerHTML = `<p class="muted small">Couldn't read the contract right now.</p>`;
  }
}

async function loadTelemetry(mount) {
  const host = mount.querySelector("#funnel");
  const errorHost = mount.querySelector("#errors");
  try {
    const metrics = await fetchMetrics();
    const counts = metrics.counts ?? {};

    const steps = [
      ["Visits", counts.page_view ?? 0],
      ["Send started", counts.send_started ?? 0],
      ["Sent", counts.send_succeeded ?? 0],
      ["Link copied", counts.claim_link_copied ?? 0],
      ["Claim opened", counts.claim_viewed ?? 0],
      ["Claimed", counts.claim_succeeded ?? 0],
    ];
    const peak = Math.max(...steps.map(([, value]) => value), 1);

    host.innerHTML = `
      <div class="bars">
        ${steps
          .map(
            ([label, value]) => `
          <div class="bar-row">
            <span class="muted small">${label}</span>
            <span class="bar-track"><span class="bar-fill" data-width="${(value / peak) * 100}"></span></span>
            <span class="bar-value">${value}</span>
          </div>`
          )
          .join("")}
      </div>
      <p class="muted small" style="margin:12px 0 0">
        ${metrics.sessionCount} sessions tracked ·
        ${metrics.updatedAt ? `updated ${new Date(metrics.updatedAt).toLocaleString()}` : "no data yet"}
      </p>`;

    // Animasikan setelah tata letak selesai supaya transisi lebarnya terlihat.
    requestAnimationFrame(() => {
      host.querySelectorAll(".bar-fill").forEach((bar) => {
        bar.style.width = `${Math.max(Number(bar.dataset.width), 2)}%`;
      });
    });

    const errors = metrics.errors ?? [];
    errorHost.innerHTML = errors.length
      ? `<div class="rows">${errors
          .slice(0, 8)
          .map(
            (error) => `
          <div class="row" style="grid-template-columns:1fr auto">
            <div class="row-main">
              <div class="row-sub mono">${escapeHtml(error.message)}</div>
            </div>
            <div class="row-sub">${error.source}</div>
          </div>`
          )
          .join("")}</div>`
      : `<p class="muted small" style="margin:0">No client errors recorded. 🎉</p>`;
  } catch {
    host.innerHTML = `<p class="muted small">Telemetry endpoint unavailable.</p>`;
    errorHost.innerHTML = `<p class="muted small">—</p>`;
  }
}

async function loadFeedback(mount) {
  const host = mount.querySelector("#feedback");
  try {
    const feedback = await fetchFeedback();
    if (!feedback.total) {
      host.innerHTML = `<p class="muted small" style="margin:0">No feedback yet — the widget is bottom-right.</p>`;
      return;
    }

    const faces = ["😖", "🙁", "😐", "🙂", "🤩"];
    host.innerHTML = `
      <div class="metrics" style="margin-bottom:12px">
        ${metric(feedback.total, "responses")}
        ${metric(feedback.averageRating?.toFixed(1) ?? "—", "average rating", true)}
      </div>
      <div class="bars">
        ${feedback.breakdown
          .slice()
          .reverse()
          .map(
            (bucket) => `
          <div class="bar-row">
            <span>${faces[bucket.score - 1]} ${bucket.score}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${
              feedback.total ? (bucket.count / feedback.total) * 100 : 0
            }%"></span></span>
            <span class="bar-value">${bucket.count}</span>
          </div>`
          )
          .join("")}
      </div>
      ${
        feedback.recent.filter((entry) => entry.comment).length
          ? `<div class="rows" style="margin-top:14px">
              ${feedback.recent
                .filter((entry) => entry.comment)
                .slice(0, 6)
                .map(
                  (entry) => `
                <div class="row" style="grid-template-columns:34px 1fr">
                  <div class="row-icon">${faces[entry.rating - 1] ?? "•"}</div>
                  <div class="row-main">
                    <div class="row-sub" style="white-space:normal">${escapeHtml(entry.comment)}</div>
                    ${entry.role ? `<div class="row-sub muted">${escapeHtml(entry.role)}</div>` : ""}
                  </div>
                </div>`
                )
                .join("")}
            </div>`
          : ""
      }`;
  } catch {
    host.innerHTML = `<p class="muted small">Feedback endpoint unavailable.</p>`;
  }
}

function metric(value, label, lit = false) {
  return `
    <div class="metric">
      <output class="${lit ? "lit" : ""}">${value}</output>
      <label>${label}</label>
    </div>`;
}

function skeletonMetrics(count) {
  return Array.from(
    { length: count },
    () => `<div class="skeleton" style="height:78px"></div>`
  ).join("");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
