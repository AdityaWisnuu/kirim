export const CONTRACT_ID = "CBMSCY57EJZHLSGVEGLVKBP75KACEJCJPO7TFEQZOO6T6DYVJDZP3SMX";

// Akun read-only untuk simulasi; tidak pernah menandatangani apa pun.
export const READ_SOURCE = "GAJG2CTQGG5WAOQNEEYJNRMXFZ3BHLAGACFCTOGXQQ44UZDUCBX4WJHV";

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const EXPLORER = "https://stellar.expert/explorer/testnet";
export const NETWORK_LABEL = "testnet";

/// Rata-rata satu ledger Stellar tertutup ~5 detik.
export const LEDGER_SECONDS = 5;

export const TOKENS = [
  {
    code: "XLM",
    name: "Stellar Lumens",
    contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    decimals: 7,
  },
  {
    code: "USDC",
    name: "USD Coin (testnet)",
    contract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    decimals: 7,
  },
];

export const CLAIM_WINDOWS = [
  { label: "1 hour", ledgers: 720 },
  { label: "1 day", ledgers: 17_280 },
  { label: "3 days", ledgers: 51_840 },
  { label: "7 days", ledgers: 120_960 },
  { label: "30 days", ledgers: 518_400 },
];

export const tokenByContract = (contract) =>
  TOKENS.find((t) => t.contract === contract);
