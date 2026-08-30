#!/usr/bin/env bash
# Siapkan tautan klaim untuk dibagikan ke penguji sungguhan.
#
# Tiap tautan mengunci sejumlah kecil XLM testnet di escrow dan menghasilkan URL
# yang bisa dibuka siapa saja — penerima memasang wallet saat klaim, dan setiap
# klaim tercatat sebagai interaksi wallet nyata di kontrak.
#
# Pakai: ./scripts/onboard.sh [jumlah_tautan] [xlm_per_tautan]
set -euo pipefail

COUNT="${1:-10}"
XLM="${2:-2}"
CONTRACT="${CONTRACT:-CBMSCY57EJZHLSGVEGLVKBP75KACEJCJPO7TFEQZOO6T6DYVJDZP3SMX}"
APP="${APP:-https://kirim-app.netlify.app}"
NETWORK="${NETWORK:-testnet}"
SENDER="${SENDER:-deployer}"
OUT="${OUT:-claim-links.txt}"

sender_pk=$(stellar keys address "$SENDER")
token=$(stellar contract id asset --asset native --network "$NETWORK")
stroops=$(python3 -c "print(int(float('$XLM') * 10_000_000))")

: > "$OUT"
echo "Membuat $COUNT tautan klaim, masing-masing $XLM XLM…"

for i in $(seq 1 "$COUNT"); do
  secret=$(openssl rand -hex 32)
  hash=$(printf '%s' "$secret" | xxd -r -p | shasum -a 256 | cut -d' ' -f1)

  id=$(stellar contract invoke --id "$CONTRACT" --source "$SENDER" --network "$NETWORK" -- \
    send --sender "$sender_pk" --token "$token" --amount "$stroops" \
    --memo "welcome to KIRIM" --ttl_ledgers 120960 --claim_hash "\"$hash\"" 2>/dev/null | tail -1)

  echo "$APP/claim?id=$id#s=$secret" | tee -a "$OUT"
done

echo
echo "Tersimpan di $OUT — bagikan satu tautan per orang."
echo "Setiap klaim memunculkan dompet baru di halaman /monitor."
