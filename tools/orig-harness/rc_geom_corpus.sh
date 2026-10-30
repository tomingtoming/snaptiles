#!/bin/bash
# Tier 2 of the 2026-10-31 difference hunt: static geometry of every corpus model on the original.
# For each model: copy it over Basic.txt, run harness_geom2.rcs, wait for geom30.txt (max 25 s), save
# runs/geom/<n>.g1.csv / <n>.g30.csv and a UTF-8 copy of the model, plus index.tsv (n, path).
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
D=$(cd "$(dirname "$0")" && pwd); RC=$HOME/rc/RC15B26; RES=$RC/Resources
RAW=/mnt/d/snaptiles-models/raw; OUT=/mnt/d/snaptiles-models/quarantine/original/runs/geom
mkdir -p "$OUT/models"
[ -f "$RES/Basic.txt.orig" ] || cp "$RES/Basic.txt" "$RES/Basic.txt.orig"
[ -f "$RES/System.rcs.orig" ] || cp "$RES/System.rcs" "$RES/System.rcs.orig"
sed "s/\r//" "$D/harness_geom2.rcs" > "$RES/System.rcs"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
: > "$OUT/index.tsv"
n=0
find "$RAW" -type f \( -iname '*.rcd' -o -iname '*.txt' \) ! -iname 'MANIFEST*' ! -name 'imgs.txt' -print0 | sort -z | while IFS= read -r -d '' f; do
  n=$((n+1)); printf '%d\t%s\n' "$n" "${f#$RAW/}" >> "$OUT/index.tsv"
  iconv -f CP932 -t UTF-8 "$f" > "$OUT/models/$n.txt" 2>/dev/null || cp "$f" "$OUT/models/$n.txt"
  [ -f "$OUT/$n.g30.csv" ] && continue
  cp "$f" "$RES/Basic.txt"; rm -f "$RES/geom1.txt" "$RES/geom30.txt"
  ( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
  WPID=$!
  for i in $(seq 1 50); do sleep 0.5; [ -f "$RES/geom30.txt" ] && break; done
  sleep 0.5
  kill $WPID 2>/dev/null; sleep 0.5; wineserver -k 2>/dev/null; sleep 0.5
  cp "$RES/geom1.txt" "$OUT/$n.g1.csv" 2>/dev/null; cp "$RES/geom30.txt" "$OUT/$n.g30.csv" 2>/dev/null || echo "$n: no geometry (${f#$RAW/})"
done
kill $XPID 2>/dev/null
cp "$RES/Basic.txt.orig" "$RES/Basic.txt"; cp "$RES/System.rcs.orig" "$RES/System.rcs"
echo "corpus geometry done: $(ls "$OUT"/*.g30.csv 2>/dev/null | wc -l) models"
