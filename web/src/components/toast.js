let host;

function ensureHost() {
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, kind = "info", ms = 4200) {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.innerHTML = message;
  ensureHost().appendChild(node);

  setTimeout(() => {
    node.classList.add("leaving");
    setTimeout(() => node.remove(), 320);
  }, ms);
  return node;
}
