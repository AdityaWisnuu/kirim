import {
  rpc,
  Contract,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { CONTRACT_ID, READ_SOURCE, RPC_URL } from "./config.js";
import { hexToBytes } from "./secret.js";

const server = new rpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

export const network = Networks.TESTNET;

// ---------------------------------------------------------------- konversi

const addressVal = (address) => nativeToScVal(address, { type: "address" });
// Soroban meng-encode `Option<T>`: None sebagai void, Some sebagai nilainya langsung.
const optionVal = (value) => value ?? xdr.ScVal.scvVoid();
const bytesVal = (hex) => nativeToScVal(hexToBytes(hex), { type: "bytes" });

// ------------------------------------------------------------- baca ledger

export async function latestLedger() {
  const { sequence } = await server.getLatestLedger();
  return sequence;
}

/// Panggilan read-only lewat simulasi — tidak butuh tanda tangan atau biaya.
async function simulate(operation) {
  const account = await server.getAccount(READ_SOURCE);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: network,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    const detail = sim.error ?? "simulation failed";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return scValToNative(sim.result.retval);
}

export const getTransfer = (id) =>
  simulate(contract.call("get_transfer", nativeToScVal(BigInt(id), { type: "u64" })));

export const getStats = () => simulate(contract.call("stats"));

export const getFeeBps = () => simulate(contract.call("fee_bps"));

export const sentBy = (address) =>
  simulate(contract.call("sent_by", addressVal(address)));

export const receivedBy = (address) =>
  simulate(contract.call("received_by", addressVal(address)));

/// Ambil beberapa transfer sekaligus, lewati yang gagal dibaca.
export async function getTransfers(ids) {
  const results = await Promise.allSettled(ids.map((id) => getTransfer(id)));
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}

// -------------------------------------------------------------- transaksi

/// Bangun → simulasikan → tanda tangani → kirim → tunggu final.
/// `onStage` melaporkan tiap fase supaya UI tidak pernah diam tanpa kabar.
async function submit({ operation, address, signTransaction, onStage }) {
  onStage?.("building");
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: network,
  })
    .addOperation(operation)
    .setTimeout(120)
    .build();

  onStage?.("simulating");
  const prepared = await server.prepareTransaction(tx);

  onStage?.("signing");
  const { signedTxXdr } = await signTransaction(prepared.toXDR());

  onStage?.("submitting");
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, network)
  );
  if (sent.status === "ERROR") {
    throw new Error(`Submission rejected: ${JSON.stringify(sent.errorResult)}`);
  }

  onStage?.("confirming");
  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && result.status === "NOT_FOUND"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== "SUCCESS") {
    throw new Error(`Transaction ${result.status}`);
  }

  return {
    hash: sent.hash,
    value: result.returnValue ? scValToNative(result.returnValue) : null,
  };
}

export function sendTransfer({
  address,
  recipient,
  token,
  amount,
  memo,
  ttlLedgers,
  claimHash,
  signTransaction,
  onStage,
}) {
  const operation = contract.call(
    "send",
    addressVal(address),
    optionVal(recipient ? addressVal(recipient) : null),
    addressVal(token),
    nativeToScVal(BigInt(amount), { type: "i128" }),
    nativeToScVal(memo, { type: "string" }),
    nativeToScVal(ttlLedgers, { type: "u32" }),
    optionVal(claimHash ? bytesVal(claimHash) : null)
  );
  return submit({ operation, address, signTransaction, onStage });
}

export function claimTransfer({ address, id, secret, signTransaction, onStage }) {
  const operation = contract.call(
    "claim",
    nativeToScVal(BigInt(id), { type: "u64" }),
    addressVal(address),
    optionVal(secret ? bytesVal(secret) : null)
  );
  return submit({ operation, address, signTransaction, onStage });
}

export function refundTransfer({ address, id, signTransaction, onStage }) {
  const operation = contract.call(
    "refund",
    nativeToScVal(BigInt(id), { type: "u64" })
  );
  return submit({ operation, address, signTransaction, onStage });
}

// ----------------------------------------------------------------- events

/// Event kontrak terbaru, dipakai untuk feed aktivitas langsung.
export async function recentEvents(limit = 60) {
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(latest.sequence - 8_000, 1);
  const page = await server.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
    limit,
  });

  return (page.events ?? [])
    .map((event) => {
      try {
        const topics = event.topic.map((t) => scValToNative(t));
        if (topics[0] !== "kirim") return null;
        const data = scValToNative(event.value);
        return {
          id: event.id,
          action: topics[1],
          transferId: Number(topics[2]),
          data,
          txHash: event.txHash,
          ledger: event.ledger,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}
