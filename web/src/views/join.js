import { walletState } from "../lib/wallet.js";
import { friendlyError } from "../lib/format.js";
import { track } from "../lib/analytics.js";
import { navigate } from "../router.js";
import { toast } from "../components/toast.js";

/// Pintu masuk swalayan: satu tautan yang bisa ditempel di mana saja, dan
/// pencoba mengurus dirinya sendiri dari situ sampai selesai klaim.
export function renderJoin({ mount, requireWallet }) {
  track("join_viewed");

  mount.innerHTML = `
    <div class="enter">
      <div>
        <h1>Get a test transfer, in one tap.</h1>
        <p class="lede">
          KIRIM keeps money in an escrow instead of firing it at an address. Grab a small test
          transfer, claim it to your own wallet, and tell me what felt wrong.
        </p>
      </div>

      <div class="panel">
        <h2>1 · Connect a wallet</h2>
        <p class="muted small" style="margin:0 0 12px" id="wallet-line"></p>
        <button id="join-connect" class="block ghost">Connect wallet</button>
        <p class="muted small" style="margin:12px 0 0">
          Don't have one yet? <a href="/try" data-link>Two-minute setup guide →</a>
        </p>
      </div>

      <div class="panel">
        <h2>2 · Claim your transfer</h2>
        <p class="muted small" style="margin:0 0 12px">
          2 test XLM — no real money, no signup, nothing to install beyond the wallet.
        </p>
        <button id="join-request" class="block">Send me a test transfer</button>
        <p class="status" id="join-status" role="status"></p>
      </div>

      <div class="panel">
        <h2>3 · Tell me what broke</h2>
        <p class="muted small" style="margin:0">
          After claiming, the 💬 button in the corner opens a one-tap feedback sheet. Honest and
          blunt is the useful kind — that's the whole reason this page exists.
        </p>
      </div>
    </div>`;

  const status = mount.querySelector("#join-status");
  const requestButton = mount.querySelector("#join-request");
  const connectButton = mount.querySelector("#join-connect");
  const walletLine = mount.querySelector("#wallet-line");

  const paintWallet = () => {
    const { address, walletName } = walletState();
    if (address) {
      walletLine.innerHTML = `Connected: <span class="mono">${address.slice(0, 6)}…${address.slice(-6)}</span>${
        walletName ? ` · ${walletName}` : ""
      }`;
      connectButton.hidden = true;
    } else {
      walletLine.textContent = "Any Stellar wallet works — Freighter, Lobstr, xBull, Albedo, Hana, Rabet.";
      connectButton.hidden = false;
    }
  };
  paintWallet();

  connectButton.addEventListener("click", async () => {
    if (await requireWallet()) paintWallet();
  });

  requestButton.addEventListener("click", async () => {
    const address = walletState().address ?? (await requireWallet());
    if (!address) return;
    paintWallet();

    requestButton.disabled = true;
    status.className = "status working";
    status.innerHTML = `<span class="spinner"></span>Locking a transfer for you on Stellar…`;
    track("join_requested");

    try {
      const response = await fetch("/api/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? `request failed (${response.status})`);

      track("join_granted", { repeat: Boolean(data.repeat) });
      status.className = "status ok";
      status.textContent = data.repeat
        ? "You already have one waiting — opening it…"
        : "Ready! Opening your claim page…";
      toast("A transfer is waiting for you 🧧", "ok");
      setTimeout(() => navigate(`/claim?id=${data.id}`), 1_200);
    } catch (error) {
      status.className = "status error";
      status.textContent = friendlyError(error);
      requestButton.disabled = false;
    }
  });
}
