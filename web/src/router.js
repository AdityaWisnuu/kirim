/// Router History API kecil: satu tempat yang memetakan URL ke tampilan,
/// dan menangkap klik tautan internal supaya navigasi tidak memuat ulang halaman.

const routes = new Map();
let onNavigate = () => {};

export function route(path, handler) {
  routes.set(path, handler);
}

export function navigate(url, { replace = false } = {}) {
  const target = new URL(url, location.origin);
  if (replace) history.replaceState({}, "", target);
  else history.pushState({}, "", target);
  resolve();
}

export function currentPath() {
  return location.pathname.replace(/\/+$/, "") || "/";
}

export async function resolve() {
  const path = currentPath();
  const handler = routes.get(path) ?? routes.get("*");
  onNavigate(path);
  await handler?.({ params: new URLSearchParams(location.search), path });
}

export function startRouter({ onNavigate: hook } = {}) {
  onNavigate = hook ?? onNavigate;

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-link]");
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(link.getAttribute("href"));
  });

  window.addEventListener("popstate", resolve);
  resolve();
}
