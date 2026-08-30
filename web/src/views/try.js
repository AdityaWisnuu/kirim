import { track } from "../lib/analytics.js";
import { walletState } from "../lib/wallet.js";
import { openFeedback } from "../components/feedback.js";

const WALLETS = [
  { name: "Freighter", url: "https://freighter.app", note: "browser extension · easiest on desktop" },
  { name: "Lobstr", url: "https://lobstr.co", note: "mobile app · easiest on a phone" },
  { name: "xBull", url: "https://xbull.app", note: "browser + mobile" },
];

/// Halaman pendaratan untuk penguji baru: tiga langkah, tanpa jargon.
/// Orang yang belum pernah menyentuh wallet berhenti di sini, bukan di tengah klaim.
export function renderTry({ mount }) {
  const connected = Boolean(walletState().address);
  track("try_viewed", { connected });

  mount.innerHTML = `
    <div class="enter">
      <div>
        <h1>Try KIRIM in two minutes</h1>
        <p class="lede">
          Someone sent you a claim link with a little test money on it. Here's how to pick it up —
          nothing here costs real money, and nothing asks for your details.
        </p>
      </div>

      <div class="panel">
        <h2>Step 1 · Get a Stellar wallet</h2>
        <p class="muted small" style="margin:0 0 12px">
          ${connected
            ? "You already have one connected — skip ahead to step 2. ✅"
            : "Pick one, install it, and switch it to <strong>Testnet</strong> in its settings."}
        </p>
        <div class="rows">
          ${WALLETS.map(
            (wallet) => `
            <a class="row" href="${wallet.url}" target="_blank" rel="noreferrer"
               data-wallet="${wallet.name}">
              <div class="row-icon">👛</div>
              <div class="row-main">
                <div class="row-title">${wallet.name}</div>
                <div class="row-sub">${wallet.note}</div>
              </div>
              <div class="row-sub">↗</div>
            </a>`
          ).join("")}
        </div>
      </div>

      <div class="panel">
        <h2>Step 2 · Open your claim link</h2>
        <p style="margin:0 0 6px">
          It looks like <span class="mono small">kirim-app.netlify.app/claim?id=12#s=…</span>
        </p>
        <p class="muted small" style="margin:0">
          The part after <span class="mono">#</span> is the secret that unlocks the money, so open
          the <strong>whole</strong> link — and treat it like cash until you've claimed it.
        </p>
      </div>

      <div class="panel">
        <h2>Step 3 · Claim, then tell me what broke</h2>
        <p style="margin:0 0 12px">
          Hit <strong>Claim</strong>, approve it in your wallet, and the money lands in your own
          account. Then please leave feedback — <em>honest</em> feedback, especially if something
          confused you. That's the part I actually need.
        </p>
        <button id="try-feedback">💬 Leave feedback</button>
      </div>

      <div class="panel">
        <h2>What is this, really?</h2>
        <p class="muted small" style="margin:0 0 8px">
          KIRIM keeps money in an escrow instead of firing it at an address: the recipient claims
          it with a link, and if nobody claims it in time, it goes back to the sender. It runs on
          Stellar <strong>testnet</strong> — the XLM here is test money with no value.
        </p>
        <p class="muted small" style="margin:0">
          Built by <a href="https://github.com/AdityaWisnuu" target="_blank" rel="noreferrer">AdityaWisnuu</a>
          for Stellar Journey to Mastery ·
          <a href="https://github.com/AdityaWisnuu/kirim" target="_blank" rel="noreferrer">source</a>
        </p>
      </div>
    </div>`;

  mount.querySelectorAll("[data-wallet]").forEach((link) => {
    link.addEventListener("click", () => track("wallet_guide_clicked", { wallet: link.dataset.wallet }));
  });
  mount.querySelector("#try-feedback").addEventListener("click", openFeedback);
}
