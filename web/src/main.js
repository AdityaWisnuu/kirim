import "./style.css";
import { NETWORK_LABEL } from "./lib/config.js";
import { route, startRouter, currentPath, navigate } from "./router.js";
import {
  connectWallet,
  disconnectWallet,
  restoreWallet,
  walletState,
  onWalletChange,
} from "./lib/wallet.js";
import { shortAddress, friendlyError } from "./lib/format.js";
import { trackPageView, installErrorTracking, track } from "./lib/analytics.js";
import { toast } from "./components/toast.js";
import { mountFeedbackButton } from "./components/feedback.js";
import { renderSend } from "./views/send.js";
import { renderClaim } from "./views/claim.js";
import { renderActivity } from "./views/activity.js";
import { renderMonitor } from "./views/monitor.js";

const NAV = [
  { path: "/", label: "Send", icon: "🧧" },
  { path: "/activity", label: "Activity", icon: "📜" },
  { path: "/monitor", label: "Monitor", icon: "📈" },
];

const app = document.querySelector("#app");
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/" data-link>
        <span class="brand-mark">🧧</span> Kirim
      </a>
      <span class="chip chip-net">${NETWORK_LABEL}</span>
      <span class="topbar-spacer"></span>
      <nav class="tabs">
        ${NAV.map((item) => `<a class="tab" href="${item.path}" data-link>${item.label}</a>`).join("")}
      </nav>
      <button class="ghost" id="wallet-button" style="padding:8px 13px;font-size:0.74rem">Connect</button>
    </header>
    <main id="view"></main>
    <nav class="bottombar">
      ${NAV.map(
        (item) => `<a href="${item.path}" data-link><b>${item.icon}</b>${item.label}</a>`
      ).join("")}
    </nav>
  </div>`;

const view = document.querySelector("#view");
const walletButton = document.querySelector("#wallet-button");

/// Buka modal dompet dan kembalikan alamatnya, atau `null` kalau dibatalkan.
async function requireWallet() {
  try {
    const { address } = await connectWallet();
    track("wallet_connected");
    toast("Wallet connected.", "ok");
    return address;
  } catch (error) {
    const message = friendlyError(error);
    if (!/cancel/i.test(message)) toast(message, "error");
    return null;
  }
}

function paintWalletButton() {
  const { address, walletName } = walletState();
  if (address) {
    walletButton.textContent = shortAddress(address);
    walletButton.title = `${address}${walletName ? ` · ${walletName}` : ""}`;
    walletButton.onclick = async () => {
      await disconnectWallet();
      toast("Wallet disconnected.");
      rerender();
    };
  } else {
    walletButton.textContent = "Connect";
    walletButton.title = "Connect a Stellar wallet";
    walletButton.onclick = async () => {
      if (await requireWallet()) rerender();
    };
  }
}

function markActiveNav(path) {
  document.querySelectorAll("[data-link]").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === path) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function rerender() {
  paintWalletButton();
  const path = currentPath();
  markActiveNav(path);
  render(path, new URLSearchParams(location.search));
}

function render(path, params) {
  const context = { mount: view, params, requireWallet };
  view.scrollTop = 0;
  if (path === "/claim") return renderClaim(context);
  if (path === "/activity") return renderActivity(context);
  if (path === "/monitor") return renderMonitor(context);
  return renderSend(context);
}

route("/", ({ params }) => render("/", params));
route("/claim", ({ params }) => render("/claim", params));
route("/activity", ({ params }) => render("/activity", params));
route("/monitor", ({ params }) => render("/monitor", params));
route("*", () => {
  view.innerHTML = `
    <div class="enter">
      <div class="empty">
        <span class="empty-emoji">🧭</span>
        <p>That page doesn't exist.</p>
        <a class="button ghost" href="/" data-link style="margin-top:10px">Go to sending</a>
      </div>
    </div>`;
});

onWalletChange(paintWalletButton);

installErrorTracking((message) => {
  console.error("[kirim]", message);
});

await restoreWallet().catch(() => {});
paintWalletButton();

startRouter({
  onNavigate: (path) => {
    markActiveNav(path);
    trackPageView(path);
  },
});

mountFeedbackButton();

// Tautan klaim yang dibagikan lewat pesan kadang kehilangan awalan; rapikan.
if (location.pathname === "/claim" && !location.search) {
  navigate("/claim", { replace: true });
}
