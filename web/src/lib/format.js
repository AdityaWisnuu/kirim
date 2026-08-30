import { LEDGER_SECONDS } from "./config.js";

const amountFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const STATUS_LABELS = ["Pending", "Claimed", "Refunded"];

/// Stroop (1e-7) → tampilan token yang mudah dibaca.
export function fromStroops(stroops, decimals = 7) {
  return Number(stroops) / 10 ** decimals;
}

export function toStroops(amount, decimals = 7) {
  // Lewat string supaya pembulatan float tidak menggeser nominal uang.
  const [whole, frac = ""] = String(amount).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function formatAmount(stroops, decimals = 7) {
  return amountFmt.format(fromStroops(stroops, decimals));
}

export function formatCompact(value) {
  return compactFmt.format(value);
}

export function shortAddress(address, lead = 4, tail = 4) {
  if (!address || address.length <= lead + tail + 1) return address ?? "";
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function statusOf(transfer) {
  const raw = transfer?.status;
  return typeof raw === "number" ? STATUS_LABELS[raw] ?? String(raw) : String(raw);
}

export function isExpired(transfer, latestLedger) {
  if (!latestLedger) return false;
  return latestLedger > Number(transfer.expiry_ledger);
}

/// Sisa waktu klaim, diperkirakan dari jarak ledger.
export function timeLeft(transfer, latestLedger) {
  if (!latestLedger) return "";
  const diff = Number(transfer.expiry_ledger) - latestLedger;
  if (diff <= 0) return "expired";
  const total = diff * LEDGER_SECONDS;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(minutes, 1)}m left`;
}

const CONTRACT_ERRORS = {
  1: "Amount must be greater than zero.",
  2: "Claim window must be between 1 minute and 30 days.",
  3: "That transfer doesn't exist.",
  4: "This transfer was already claimed or refunded.",
  5: "The claim window has closed — only the sender can refund it now.",
  6: "Not expired yet — the recipient can still claim it.",
  7: "This transfer is reserved for a different wallet.",
  8: "That claim link is invalid.",
  9: "This transfer needs a claim link with its secret.",
  10: "Your note is too long — keep it under 140 characters.",
  11: "Fee is above the protocol cap.",
  12: "You can't send a transfer to yourself.",
  13: "This transfer has no valid claim target.",
};

/// Ubah kegagalan kontrak/jaringan jadi kalimat yang berarti bagi pengguna.
export function friendlyError(error) {
  const text = String(error?.message ?? error ?? "");
  const code = text.match(/Error\(Contract, #(\d+)\)/);
  if (code && CONTRACT_ERRORS[code[1]]) return CONTRACT_ERRORS[code[1]];
  if (/User (declined|rejected)|denied|cancell?ed/i.test(text))
    return "Signature cancelled in your wallet.";
  if (/insufficient|underfunded|balance/i.test(text))
    return "Not enough balance in your wallet for this transfer.";
  if (/trustline|trust line/i.test(text))
    return "Your wallet needs a trustline for this asset first.";
  if (/network|fetch|timeout|Failed to fetch/i.test(text))
    return "Network hiccup — check your connection and try again.";
  return text || "Something went wrong.";
}
