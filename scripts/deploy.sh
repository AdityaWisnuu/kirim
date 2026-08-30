#!/usr/bin/env bash
# KIRIM — alur deploy kontrak yang bisa diulang (testnet).
# Pakai: ./scripts/deploy.sh [identity] [fee_bps]
set -euo pipefail

IDENTITY="${1:-deployer}"
FEE_BPS="${2:-0}"
NETWORK="${NETWORK:-testnet}"

echo "== 1. test"
cargo test --workspace

echo "== 2. build wasm"
stellar contract build

echo "== 3. deploy (admin & treasury = $IDENTITY, fee ${FEE_BPS}bps)"
admin=$(stellar keys address "$IDENTITY")
contract=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/kirim.wasm \
  --source "$IDENTITY" --network "$NETWORK" \
  -- --admin "$admin" --treasury "$admin" --fee_bps "$FEE_BPS" | tail -1)

echo
echo "Deployed: $contract"
echo "Selanjutnya: set CONTRACT_ID di web/src/lib/config.js dan README.md"
