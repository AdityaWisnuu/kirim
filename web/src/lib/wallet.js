import {
  StellarWalletsKit,
  Networks as KitNetworks,
} from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { network } from "./chain.js";

const STORAGE_KEY = "kirim:wallet";

StellarWalletsKit.init({
  network: KitNetworks.TESTNET,
  modules: [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new HanaModule(),
    new RabetModule(),
  ],
});

const listeners = new Set();
let state = { address: null, walletName: null };

export function walletState() {
  return state;
}

export function onWalletChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next) {
  state = next;
  for (const listener of listeners) listener(state);
}

function remember(address, walletName) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ address, walletName }));
  } catch {
    // Mode privat memblokir penyimpanan — sesi tetap jalan tanpa itu.
  }
}

/// Sambungkan lagi dompet yang terakhir dipakai, tanpa memunculkan modal.
export async function restoreWallet() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved?.address) return state;

  setState({ address: saved.address, walletName: saved.walletName });
  return state;
}

export async function connectWallet() {
  const { address } = await StellarWalletsKit.authModal();
  const walletName = StellarWalletsKit.selectedModule?.productName ?? "wallet";
  remember(address, walletName);
  setState({ address, walletName });
  return state;
}

export async function disconnectWallet() {
  await StellarWalletsKit.disconnect().catch(() => {});
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // abaikan
  }
  setState({ address: null, walletName: null });
}

/// Penandatangan yang diserahkan ke lapisan transaksi.
export function signer(address) {
  return (xdr) =>
    StellarWalletsKit.signTransaction(xdr, {
      address,
      networkPassphrase: network,
    });
}
