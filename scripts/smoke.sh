#!/usr/bin/env bash
# Uji kedua mode klaim KIRIM di testnet: direct dan link (hashlock).
# Pakai: ./scripts/smoke.sh [contract-alias]
set -euo pipefail

CONTRACT="${1:-kirim}"
NETWORK="${NETWORK:-testnet}"
SENDER="${SENDER:-deployer}"
RECIPIENT="${RECIPIENT:-tipper}"
TOKEN=$(stellar contract id asset --asset native --network "$NETWORK")

sender_pk=$(stellar keys address "$SENDER")
recipient_pk=$(stellar keys address "$RECIPIENT")

echo "== 1. direct: kunci 5 XLM untuk $recipient_pk"
direct_id=$(stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network "$NETWORK" -- \
  send --sender "$sender_pk" --recipient "\"$recipient_pk\"" --token "$TOKEN" \
  --amount 50000000 --memo "direct smoke test" --ttl_ledgers 17280 | tail -1)
echo "   id: $direct_id"

echo "== 2. direct: penerima menarik dana"
stellar contract invoke --id "$CONTRACT" --source "$RECIPIENT" --network "$NETWORK" -- \
  claim --id "$direct_id" --claimer "$recipient_pk" >/dev/null
stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network "$NETWORK" -- \
  get_transfer --id "$direct_id" | tail -1

echo "== 3. link: kunci 3 XLM di balik secret"
secret=$(openssl rand -hex 32)
hash=$(printf '%s' "$secret" | xxd -r -p | shasum -a 256 | cut -d' ' -f1)
link_id=$(stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network "$NETWORK" -- \
  send --sender "$sender_pk" --token "$TOKEN" --amount 30000000 \
  --memo "link smoke test" --ttl_ledgers 17280 --claim_hash "\"$hash\"" | tail -1)
echo "   id: $link_id  secret: $secret"

echo "== 4. link: wallet lain menebus secret"
stellar contract invoke --id "$CONTRACT" --source "$RECIPIENT" --network "$NETWORK" -- \
  claim --id "$link_id" --claimer "$recipient_pk" --secret "\"$secret\"" >/dev/null
stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network "$NETWORK" -- \
  get_transfer --id "$link_id" | tail -1

echo "== 5. stats"
stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network "$NETWORK" -- stats | tail -1
