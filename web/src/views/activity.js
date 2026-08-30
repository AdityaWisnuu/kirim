import { EXPLORER, tokenByContract } from "../lib/config.js";
import { sentBy, receivedBy, getTransfers, latestLedger, recentEvents } from "../lib/chain.js";
import { walletState } from "../lib/wallet.js";
import { formatAmount, shortAddress, statusOf, timeLeft, isExpired } from "../lib/format.js";
import { track } from "../lib/analytics.js";

export async function renderActivity({ mount, requireWallet }) {
  const address = walletState().address;

  mount.innerHTML = `
    <div class="enter">
      <div>
        <h1>Activity</h1>
        <p class="lede">Everything you've sent and claimed, read straight from the contract.</p>
      </div>
      <div id="mine"></div>
      <div class="panel">
        <h2>Live on the escrow <span class="livedot" id="livedot"></span></h2>
        <div class="rows" id="feed">
          ${skeletonRows(3)}
        </div>
      </div>
    </div>`;

  const mine = mount.querySelector("#mine");

  if (!address) {
    mine.innerHTML = `
      <div class="empty">
        <span class="empty-emoji">👛</span>
        <p>Connect a wallet to see your own transfers.</p>
        <button id="connect-cta" style="margin-top:10px">Connect wallet</button>
      </div>`;
    mine.querySelector("#connect-cta").addEventListener("click", async () => {
      if (await requireWallet()) renderActivity({ mount, requireWallet });
    });
  } else {
    mine.innerHTML = `<div class="panel"><h2>Yours</h2><div class="rows">${skeletonRows(2)}</div></div>`;
    loadMine({ mine, address });
  }

  loadFeed(mount);
}

async function loadMine({ mine, address }) {
  try {
    const [sentIds, receivedIds, ledger] = await Promise.all([
      sentBy(address),
      receivedBy(address),
      latestLedger(),
    ]);

    const ids = [...new Set([...sentIds, ...receivedIds].map(Number))].sort((a, b) => b - a);
    if (ids.length === 0) {
      mine.innerHTML = `
        <div class="empty">
          <span class="empty-emoji">🧧</span>
          <p>No transfers yet.</p>
          <a class="button ghost" href="/" data-link style="margin-top:10px">Send your first one</a>
        </div>`;
      return;
    }

    const transfers = await getTransfers(ids.slice(0, 25));
    mine.innerHTML = `
      <div class="panel">
        <h2>Yours · ${transfers.length}</h2>
        <div class="rows">
          ${transfers.map((t) => transferRow(t, address, ledger)).join("")}
        </div>
      </div>`;
    track("activity_loaded", { count: transfers.length });
  } catch {
    mine.innerHTML = `
      <div class="empty">
        <p>Couldn't reach the network just now.</p>
        <p class="small">Your transfers are safe on-chain — try refreshing.</p>
      </div>`;
  }
}

function transferRow(transfer, address, ledger) {
  const token = tokenByContract(transfer.token);
  const outgoing = transfer.sender === address;
  const status = statusOf(transfer);
  const expired = isExpired(transfer, ledger);
  const icon = outgoing ? "↗" : "↘";
  const note = transfer.memo && transfer.memo !== "🧧" ? transfer.memo : "";

  const subtitle =
    status === "Pending"
      ? expired
        ? outgoing
          ? "Expired — you can refund it"
          : "Claim window closed"
        : timeLeft(transfer, ledger)
      : status === "Claimed"
        ? `Claimed by ${shortAddress(transfer.claimed_by ?? "", 4, 4)}`
        : "Refunded to sender";

  return `
    <a class="row" href="/claim?id=${transfer.id}" data-link>
      <div class="row-icon">${icon}</div>
      <div class="row-main">
        <div class="row-title">${outgoing ? "Sent" : "Received"}${note ? ` · ${escapeHtml(note)}` : ""}</div>
        <div class="row-sub">#${transfer.id} · ${subtitle}</div>
      </div>
      <div style="text-align:right">
        <div class="row-amount">${formatAmount(transfer.amount, token?.decimals ?? 7)}</div>
        <div class="row-sub">${token?.code ?? ""}</div>
      </div>
    </a>`;
}

async function loadFeed(mount) {
  const feed = mount.querySelector("#feed");
  const dot = mount.querySelector("#livedot");
  const seen = new Set();

  const tick = async () => {
    if (!document.body.contains(feed)) return; // tampilan sudah ditinggalkan
    try {
      const events = await recentEvents(24);
      dot?.classList.add("on");

      if (events.length === 0) {
        feed.innerHTML = `<div class="empty"><p class="small">No activity in the recent window.</p></div>`;
      } else {
        feed.innerHTML = events
          .map((event) => {
            const fresh = seen.size > 0 && !seen.has(event.id);
            seen.add(event.id);
            return eventRow(event, fresh);
          })
          .join("");
        events.forEach((event) => seen.add(event.id));
      }
    } catch {
      dot?.classList.remove("on");
    }
    setTimeout(tick, 7_000);
  };

  tick();
}

function eventRow(event, fresh) {
  const icons = { sent: "📤", claimed: "✅", refunded: "↩️" };
  const amount = event.action === "sent" ? event.data[2] : event.data[1];
  return `
    <a class="row ${fresh ? "fresh" : ""}" href="${EXPLORER}/tx/${event.txHash}"
       target="_blank" rel="noreferrer">
      <div class="row-icon">${icons[event.action] ?? "•"}</div>
      <div class="row-main">
        <div class="row-title">${event.action}</div>
        <div class="row-sub">transfer #${event.transferId}</div>
      </div>
      <div class="row-amount">${formatAmount(amount)}</div>
    </a>`;
}

function skeletonRows(count) {
  return Array.from({ length: count }, () => `<div class="skeleton skeleton-row"></div>`).join("");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
