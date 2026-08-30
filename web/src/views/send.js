import { TOKENS, CLAIM_WINDOWS, EXPLORER } from "../lib/config.js";
import { sendTransfer, getFeeBps } from "../lib/chain.js";
import { walletState, signer } from "../lib/wallet.js";
import { toStroops, formatAmount, friendlyError } from "../lib/format.js";
import { randomSecret, sha256Hex, buildClaimLink } from "../lib/secret.js";
import { track } from "../lib/analytics.js";
import { toast } from "../components/toast.js";
import { maybeAskForFeedback } from "../components/feedback.js";

const STAGE_COPY = {
  building: "Preparing the transfer…",
  simulating: "Checking it against the network…",
  signing: "Waiting for your wallet signature…",
  submitting: "Sending to Stellar…",
  confirming: "Waiting for confirmation…",
};

export function renderSend({ mount, requireWallet }) {
  let mode = "link";
  let feeBps = 0;

  mount.innerHTML = `
    <div class="enter">
      <div>
        <h1>Send money that can come back to you.</h1>
        <p class="lede">
          Funds wait in an escrow on Stellar. Your recipient claims them with a link —
          no wallet needed up front — and if nobody claims, the money returns to you.
        </p>
      </div>

      <div class="panel">
        <div class="segmented" role="group" aria-label="Delivery method">
          <button type="button" data-mode="link" aria-pressed="true">
            Share a link <small>recipient needs no wallet</small>
          </button>
          <button type="button" data-mode="address" aria-pressed="false">
            To an address <small>you know their wallet</small>
          </button>
        </div>

        <form id="send-form" style="margin-top:15px">
          <label id="recipient-field" hidden>
            <span>Recipient wallet</span>
            <input id="recipient" class="mono" placeholder="G…" pattern="G[A-Z2-7]{55}" />
          </label>

          <label>
            <span>Amount</span>
            <div class="amount-row">
              <input id="amount" type="number" inputmode="decimal" min="0.0000001"
                     step="any" value="5" required aria-label="Amount to send" />
              <select id="token" aria-label="Asset">
                ${TOKENS.map((t) => `<option value="${t.contract}">${t.code}</option>`).join("")}
              </select>
            </div>
            <span class="muted small" id="fee-note" style="text-transform:none;letter-spacing:0"></span>
          </label>

          <label>
            <span>Note for them</span>
            <input id="memo" maxlength="140" placeholder="buat keluarga di rumah" />
          </label>

          <label>
            <span>Claim window</span>
            <select id="window">
              ${CLAIM_WINDOWS.map(
                (w, i) =>
                  `<option value="${w.ledgers}" ${i === 1 ? "selected" : ""}>${w.label}</option>`
              ).join("")}
            </select>
          </label>

          <button class="block" type="submit" id="send-button">Lock &amp; create link</button>
          <p class="status" id="send-status" role="status"></p>
        </form>
      </div>

      <div id="result"></div>
    </div>
  `;

  const form = mount.querySelector("#send-form");
  const status = mount.querySelector("#send-status");
  const button = mount.querySelector("#send-button");
  const recipientField = mount.querySelector("#recipient-field");
  const feeNote = mount.querySelector("#fee-note");

  const setStatus = (html, kind = "working") => {
    status.className = `status ${kind}`;
    status.innerHTML = html;
  };

  // Tampilkan biaya protokol apa adanya, sebelum orang menekan kirim.
  getFeeBps()
    .then((bps) => {
      feeBps = Number(bps);
      feeNote.textContent =
        feeBps > 0
          ? `Protocol fee ${(feeBps / 100).toFixed(2)}% — taken only when it's claimed.`
          : "No protocol fee — you only pay Stellar's network fee (a fraction of a cent).";
    })
    .catch(() => {});

  mount.querySelectorAll("[data-mode]").forEach((tab) => {
    tab.addEventListener("click", () => {
      mode = tab.dataset.mode;
      mount.querySelectorAll("[data-mode]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === tab));
      });
      recipientField.hidden = mode !== "address";
      mount.querySelector("#recipient").required = mode === "address";
      button.textContent = mode === "link" ? "Lock & create link" : "Lock & send";
      track("send_mode_changed", { mode });
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const address = walletState().address ?? (await requireWallet());
    if (!address) return;

    const token = mount.querySelector("#token").value;
    const tokenMeta = TOKENS.find((t) => t.contract === token);
    const amountInput = mount.querySelector("#amount").value;
    const memo = mount.querySelector("#memo").value.trim() || "🧧";
    const ttlLedgers = Number(mount.querySelector("#window").value);
    const recipient = mode === "address" ? mount.querySelector("#recipient").value.trim() : null;

    if (mode === "address" && recipient === address) {
      setStatus("That's your own wallet — pick someone else.", "error");
      return;
    }

    let amount;
    try {
      amount = toStroops(amountInput, tokenMeta.decimals);
      if (amount <= 0n) throw new Error("zero");
    } catch {
      setStatus("Enter an amount greater than zero.", "error");
      return;
    }

    button.disabled = true;
    button.classList.add("pulse");
    track("send_started", { mode, token: tokenMeta.code });

    // Rahasia dibuat di perangkat ini; kontrak hanya pernah melihat hash-nya.
    const secret = mode === "link" ? randomSecret() : null;
    const claimHash = secret ? await sha256Hex(secret) : null;

    try {
      const { hash, value } = await sendTransfer({
        address,
        recipient,
        token,
        amount,
        memo,
        ttlLedgers,
        claimHash,
        signTransaction: signer(address),
        onStage: (stage) =>
          setStatus(`<span class="spinner"></span>${STAGE_COPY[stage] ?? stage}…`),
      });

      const id = Number(value);
      track("send_succeeded", { mode, token: tokenMeta.code, id });
      setStatus("", "ok");
      renderResult({ mount, id, hash, secret, mode, recipient, amount, tokenMeta, memo });
      maybeAskForFeedback();
    } catch (error) {
      const message = friendlyError(error);
      track("send_failed", { message: message.slice(0, 80) });
      setStatus(message, "error");
      toast(message, "error");
    } finally {
      button.disabled = false;
      button.classList.remove("pulse");
    }
  });
}

function renderResult({ mount, id, hash, secret, mode, recipient, amount, tokenMeta, memo }) {
  const link = secret
    ? buildClaimLink(location.origin, id, secret)
    : `${location.origin}/claim?id=${id}`;
  const pretty = `${formatAmount(amount, tokenMeta.decimals)} ${tokenMeta.code}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(
    `Aku kirim ${pretty} buat kamu lewat KIRIM 🧧\n"${memo}"\nKlaim di sini: ${link}`
  )}`;

  const result = mount.querySelector("#result");
  result.innerHTML = `
    <div class="panel landed" style="margin-top:14px">
      <h2>🔒 Locked in escrow</h2>
      <p style="margin:0 0 4px"><strong>${pretty}</strong> is waiting as transfer #${id}.</p>
      <p class="muted small" style="margin:0">
        ${
          mode === "link"
            ? "Anyone with this link can claim it — treat it like cash. If nobody does before the window closes, refund it from Activity."
            : `Reserved for ${recipient.slice(0, 6)}…${recipient.slice(-4)}. Only that wallet can claim.`
        }
      </p>

      <div class="linkbox">
        <input id="claim-link" readonly value="${link}" aria-label="Claim link" />
        <button id="copy-link" type="button">Copy</button>
      </div>

      <div class="share-row">
        <a class="button ghost" href="${whatsapp}" target="_blank" rel="noreferrer">Share on WhatsApp</a>
        <a class="button ghost" href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">View on explorer</a>
      </div>
    </div>
  `;

  result.querySelector("#copy-link").addEventListener("click", async () => {
    const input = result.querySelector("#claim-link");
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      input.select();
      document.execCommand?.("copy");
    }
    track("claim_link_copied", { id });
    toast("Claim link copied — send it to them. 🧧", "ok");
  });

  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
