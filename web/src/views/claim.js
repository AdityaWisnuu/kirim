import { EXPLORER, CONTRACT_ID, tokenByContract } from "../lib/config.js";
import { getTransfer, claimTransfer, refundTransfer, latestLedger } from "../lib/chain.js";
import { walletState, signer } from "../lib/wallet.js";
import { formatAmount, shortAddress, statusOf, timeLeft, isExpired, friendlyError } from "../lib/format.js";
import { readSecretFromLocation } from "../lib/secret.js";
import { track } from "../lib/analytics.js";
import { toast } from "../components/toast.js";
import { maybeAskForFeedback } from "../components/feedback.js";

const STAGE_COPY = {
  building: "Preparing your claim…",
  simulating: "Checking it against the network…",
  signing: "Waiting for your wallet signature…",
  submitting: "Sending to Stellar…",
  confirming: "Waiting for confirmation…",
};

export async function renderClaim({ mount, params, requireWallet }) {
  const id = params.get("id");
  const secret = readSecretFromLocation(location);

  if (id === null || id === "") {
    mount.innerHTML = `
      <div class="enter">
        <h1>Claim a transfer</h1>
        <p class="lede">Open the link someone shared with you, or paste a transfer number below.</p>
        <form class="panel" id="lookup">
          <label><span>Transfer number</span>
            <input id="lookup-id" type="number" min="0" step="1" placeholder="0" required />
          </label>
          <button type="submit">Look it up</button>
        </form>
      </div>`;
    mount.querySelector("#lookup").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = mount.querySelector("#lookup-id").value;
      location.assign(`/claim?id=${encodeURIComponent(value)}`);
    });
    return;
  }

  mount.innerHTML = `
    <div class="enter">
      <div class="claim-hero">
        <div class="skeleton skeleton-line" style="width:52%;margin:0 auto"></div>
        <div class="skeleton" style="height:54px;margin:16px auto;width:70%"></div>
        <div class="skeleton skeleton-line" style="width:38%;margin:0 auto"></div>
      </div>
    </div>`;

  let transfer;
  let ledger;
  try {
    [transfer, ledger] = await Promise.all([getTransfer(id), latestLedger()]);
  } catch (error) {
    mount.innerHTML = `
      <div class="enter">
        <div class="empty">
          <span class="empty-emoji">🕵️</span>
          <p>We couldn't find transfer #${id}.</p>
          <p class="small">Double-check the link, or ask the sender to share it again.</p>
        </div>
        <a class="button ghost block" href="/" data-link style="margin-top:14px">Back to sending</a>
      </div>`;
    track("claim_not_found", { id: Number(id) });
    return;
  }

  track("claim_viewed", { id: Number(id), status: statusOf(transfer) });
  paint({ mount, transfer, ledger, secret, requireWallet, id });
}

function paint({ mount, transfer, ledger, secret, requireWallet, id }) {
  const token = tokenByContract(transfer.token);
  const decimals = token?.decimals ?? 7;
  const code = token?.code ?? "tokens";
  const status = statusOf(transfer);
  const expired = isExpired(transfer, ledger);
  const wallet = walletState().address;

  const isLinkMode = !transfer.recipient;
  const claimable =
    status === "Pending" &&
    !expired &&
    (isLinkMode ? Boolean(secret) : transfer.recipient === wallet);
  const refundable = status === "Pending" && expired && transfer.sender === wallet;

  const headline =
    status === "Claimed"
      ? "Already claimed"
      : status === "Refunded"
        ? "Returned to sender"
        : expired
          ? "Claim window closed"
          : "Someone sent you money";

  mount.innerHTML = `
    <div class="enter">
      <div class="claim-hero">
        <p class="muted small" style="margin:0">${headline}</p>
        <div class="claim-amount">${formatAmount(transfer.amount, decimals)} ${code}</div>
        <p class="muted small mono" style="margin:0">
          from ${shortAddress(transfer.sender, 6, 6)}
        </p>
        ${transfer.memo && transfer.memo !== "🧧" ? `<p class="claim-note">“${escapeHtml(transfer.memo)}”</p>` : ""}
        <p style="margin:16px 0 0">
          <span class="pill pill-${status.toLowerCase()}">${status}</span>
          ${status === "Pending" ? `<span class="pill">${timeLeft(transfer, ledger)}</span>` : ""}
        </p>
      </div>

      <div class="panel" style="margin-top:14px" id="action-panel"></div>

      <div class="panel">
        <h2>Details</h2>
        <div class="rows">
          ${detailRow("Transfer", `#${transfer.id}`)}
          ${detailRow("Asset", token ? `${token.code} · ${token.name}` : shortAddress(transfer.token, 6, 6))}
          ${detailRow("Claim mode", isLinkMode ? "Anyone with the link" : `Reserved for ${shortAddress(transfer.recipient, 6, 6)}`)}
          ${transfer.claimed_by ? detailRow("Claimed by", shortAddress(transfer.claimed_by, 6, 6)) : ""}
          ${detailRow("Escrow", `<a href="${EXPLORER}/contract/${CONTRACT_ID}" target="_blank" rel="noreferrer">${shortAddress(CONTRACT_ID, 4, 4)}</a>`)}
        </div>
      </div>
    </div>`;

  const panel = mount.querySelector("#action-panel");

  if (claimable) {
    panel.innerHTML = `
      <button class="block" id="claim-button">Claim ${formatAmount(transfer.amount, decimals)} ${code}</button>
      <p class="muted small" style="margin:10px 0 0">
        ${wallet
          ? "Goes straight to your connected wallet."
          : `No wallet yet? <a href="/try" data-link>Two-minute setup guide →</a>`}
      </p>
      <p class="status" id="claim-status" role="status"></p>`;
    panel.querySelector("#claim-button").addEventListener("click", () =>
      doClaim({ mount, transfer, secret, requireWallet, id })
    );
  } else if (refundable) {
    panel.innerHTML = `
      <p style="margin:0 0 12px">Nobody claimed this in time, so you can take it back.</p>
      <button class="block ghost" id="refund-button">Refund to my wallet</button>
      <p class="status" id="claim-status" role="status"></p>`;
    panel.querySelector("#refund-button").addEventListener("click", () =>
      doRefund({ mount, transfer, requireWallet, id })
    );
  } else if (status === "Pending" && !isLinkMode && transfer.recipient !== wallet) {
    panel.innerHTML = `
      <p style="margin:0">This transfer is reserved for
        <span class="mono">${shortAddress(transfer.recipient, 6, 6)}</span>.</p>
      <p class="muted small" style="margin:8px 0 0">Connect that wallet to claim it.</p>`;
  } else if (status === "Pending" && isLinkMode && !secret) {
    panel.innerHTML = `
      <p style="margin:0">This one needs its claim link.</p>
      <p class="muted small" style="margin:8px 0 0">
        The secret lives in the part of the URL after <span class="mono">#</span> — ask the sender to
        share the full link again.
      </p>`;
  } else if (status === "Pending" && expired) {
    panel.innerHTML = `<p style="margin:0">The window closed. Only the sender can refund it now.</p>`;
  } else {
    panel.innerHTML = `
      <p style="margin:0">This transfer is settled.</p>
      <a class="button ghost block" href="/" data-link style="margin-top:12px">Send one of your own</a>`;
  }
}

async function doClaim({ mount, transfer, secret, requireWallet, id }) {
  const address = walletState().address ?? (await requireWallet());
  if (!address) return;

  const button = mount.querySelector("#claim-button");
  const status = mount.querySelector("#claim-status");
  button.disabled = true;
  track("claim_started", { id: Number(id) });

  try {
    const { hash } = await claimTransfer({
      address,
      id,
      secret,
      signTransaction: signer(address),
      onStage: (stage) => {
        status.className = "status working";
        status.innerHTML = `<span class="spinner"></span>${STAGE_COPY[stage] ?? stage}…`;
      },
    });

    track("claim_succeeded", { id: Number(id) });
    document.querySelector(".claim-hero")?.classList.add("landed");
    status.className = "status ok";
    status.innerHTML = `Money's in your wallet. <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">See it on-chain ↗</a>`;
    toast("Claimed 🎉 The money is yours.", "ok");
    renderShareLoop(mount);
    maybeAskForFeedback();

    const fresh = await getTransfer(id);
    const ledger = await latestLedger();
    setTimeout(() => paint({ mount, transfer: fresh, ledger, secret, requireWallet, id }), 2_200);
  } catch (error) {
    const message = friendlyError(error);
    track("claim_failed", { message: message.slice(0, 80) });
    status.className = "status error";
    status.textContent = message;
    button.disabled = false;
  }
}

async function doRefund({ mount, transfer, requireWallet, id }) {
  const address = walletState().address ?? (await requireWallet());
  if (!address) return;

  const button = mount.querySelector("#refund-button");
  const status = mount.querySelector("#claim-status");
  button.disabled = true;

  try {
    const { hash } = await refundTransfer({
      address,
      id,
      signTransaction: signer(address),
      onStage: (stage) => {
        status.className = "status working";
        status.innerHTML = `<span class="spinner"></span>${STAGE_COPY[stage] ?? stage}…`;
      },
    });
    track("refund_succeeded", { id: Number(id) });
    status.className = "status ok";
    status.innerHTML = `Refunded. <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">See it on-chain ↗</a>`;
    toast("Refunded — the money is back with you.", "ok");
  } catch (error) {
    const message = friendlyError(error);
    track("refund_failed", { message: message.slice(0, 80) });
    status.className = "status error";
    status.textContent = message;
    button.disabled = false;
  }
}

function detailRow(label, value) {
  return `
    <div class="row" style="grid-template-columns:1fr auto">
      <div class="row-sub">${label}</div>
      <div class="small mono">${value}</div>
    </div>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/// Orang yang baru saja menerima uang adalah orang yang paling paham gunanya.
/// Di situlah tempat paling wajar untuk menawarkan meneruskannya.
function renderShareLoop(mount) {
  const join = `${location.origin}/join`;
  const pitch = "Barusan nyoba KIRIM 🧧 — kirim uang di Stellar pakai escrow, penerima klaim lewat link, dan kalau nggak diklaim uangnya balik ke pengirim. Coba deh:";

  const panel = mount.querySelector("#action-panel");
  if (!panel) return;

  panel.insertAdjacentHTML(
    "beforeend",
    `<div class="panel landed" style="margin-top:16px;background:var(--ink-2)">
       <h2>Pass it on</h2>
       <p class="muted small" style="margin:0 0 12px">
         Know someone who'd get it? One tap and they can try it too.
       </p>
       <div class="share-row">
         <a class="button ghost" data-share="whatsapp"
            href="https://wa.me/?text=${encodeURIComponent(`${pitch} ${join}`)}"
            target="_blank" rel="noreferrer">WhatsApp</a>
         <a class="button ghost" data-share="x"
            href="https://x.com/intent/post?text=${encodeURIComponent(pitch)}&url=${encodeURIComponent(join)}"
            target="_blank" rel="noreferrer">Post on X</a>
         <button class="ghost" data-share="copy" id="share-copy">Copy link</button>
       </div>
     </div>`
  );

  panel.querySelectorAll("[data-share]").forEach((control) => {
    control.addEventListener("click", async () => {
      track("share_clicked", { channel: control.dataset.share });
      if (control.dataset.share !== "copy") return;
      try {
        await navigator.clipboard.writeText(join);
        toast("Link copied — send it to them 🧧", "ok");
      } catch {
        toast(join);
      }
    });
  });
}
