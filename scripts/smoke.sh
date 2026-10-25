#!/usr/bin/env bash
# Smoke test HTTP. Pakai: bash scripts/smoke.sh [port]
set -u
PORT="${1:-3000}"
BASE="http://localhost:$PORT"
pass=0; fail=0
chk() { # chk "nama" "harapan" "hasil"
  if [ "$2" = "$3" ]; then echo "  ok   $1  ($3)"; pass=$((pass+1));
  else echo "  FAIL $1  harap=$2 dapat=$3"; fail=$((fail+1)); fi
}
jqv() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const p=process.argv[1].split(".");let v=o;for(const k of p)v=v?.[k];console.log(v===undefined?"":String(v))}catch{console.log("")}})' "$2"; }

echo "== 1. health"
R=$(curl -s "$BASE/api/health"); chk "ok=true" "true" "$(jqv "$R" ok)"

echo "== 2. buat paste"
R=$(curl -s -X POST "$BASE/api/paste" -H 'Content-Type: application/json' \
  -d '{"content":"halo dari curl\nbaris dua","lang":"text"}')
ID=$(jqv "$R" id); TOK=$(jqv "$R" deleteToken)
chk "id 10 hex" "10" "${#ID}"
chk "url berisi id" "true" "$(jqv "$R" url | grep -c "$ID" >/dev/null && echo true || echo false)"

echo "== 3. ambil paste"
R=$(curl -s "$BASE/api/paste/$ID")
chk "content" $'halo dari curl\nbaris dua' "$(jqv "$R" content)"
chk "views=1" "1" "$(jqv "$R" views)"

echo "== 4. raw text/plain"
CT=$(curl -s -o /dev/null -w '%{content_type}' "$BASE/api/paste/$ID/raw")
chk "content-type" "text/plain; charset=utf-8" "$CT"
chk "isi raw" "halo dari curl" "$(curl -s "$BASE/api/paste/$ID/raw" | head -1)"

echo "== 5. list & stats"
chk "id ada di list" "true" "$(curl -s "$BASE/api/list" | grep -c "$ID" >/dev/null && echo true || echo false)"
R=$(curl -s "$BASE/api/stats"); chk "items>=1" "true" "$([ "$(jqv "$R" items)" -ge 1 ] && echo true || echo false)"
chk "nextWipeAt>0" "true" "$([ "$(jqv "$R" nextWipeAt)" -gt 0 ] && echo true || echo false)"

echo "== 6. hapus token salah"
C=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/paste/$ID" \
  -H 'Content-Type: application/json' -d '{"deleteToken":"palsu"}')
chk "http 403" "403" "$C"

echo "== 7. paste kebesaran"
BIG=$(mktemp)
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({content:"x".repeat(200*1024+1)}))' "$BIG"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/paste" -H 'Content-Type: application/json' --data-binary @"$BIG")
rm -f "$BIG"
chk "http 413" "413" "$C"

echo "== 8. body kosong"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/paste" -H 'Content-Type: application/json' -d '{}')
chk "http 400" "400" "$C"

echo "== 9. burn after read"
R=$(curl -s -X POST "$BASE/api/paste" -H 'Content-Type: application/json' -d '{"content":"sekali baca","burn":true}')
BID=$(jqv "$R" id)
chk "baca pertama" "sekali baca" "$(jqv "$(curl -s "$BASE/api/paste/$BID")" content)"
C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/paste/$BID")
chk "baca kedua 404" "404" "$C"

echo "== 10. unlisted tidak di list"
R=$(curl -s -X POST "$BASE/api/paste" -H 'Content-Type: application/json' -d '{"content":"sembunyi","unlisted":true}')
UID_=$(jqv "$R" id)
chk "tidak muncul" "0" "$(curl -s "$BASE/api/list" | grep -c "$UID_")"

echo "== 11. hapus dengan token benar"
C=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/paste/$ID" \
  -H 'Content-Type: application/json' -d "{\"deleteToken\":\"$TOK\"}")
chk "http 200" "200" "$C"
C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/paste/$ID")
chk "sudah hilang 404" "404" "$C"

echo "== 12. path tidak ada"
chk "404 json" "not found" "$(jqv "$(curl -s "$BASE/api/nope")" error)"

echo "== 13. cron purge (wipe semua)"
R=$(curl -s "$BASE/api/cron/purge")
chk "wiped>=1" "true" "$([ "$(jqv "$R" wiped)" -ge 1 ] && echo true || echo false)"
chk "items=0" "0" "$(jqv "$(curl -s "$BASE/api/stats")" items)"
chk "unlisted pun hilang" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/paste/$UID_")"

echo
echo "HASIL: $pass lolos, $fail gagal"
[ "$fail" -eq 0 ]
