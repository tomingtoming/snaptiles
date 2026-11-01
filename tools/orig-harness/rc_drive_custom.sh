#!/bin/bash
# rc_drive_corpus.sh with HARNESS (file name in this directory) and OUTDIR overridable; INDEX limits the models (n list)
# (150 m base), once with no input ("idle") and once holding Up ("up", key 0) from 6 s after launch until the
# log is written (frame 600). Logs to runs/drive/<n>.<mode>.csv; resumable (existing logs are skipped).
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
D=$(cd "$(dirname "$0")" && pwd); RC=$HOME/rc/RC15B26; RES=$RC/Resources
RAW=/mnt/d/snaptiles-models/raw; G=/mnt/d/snaptiles-models/quarantine/original/runs/geom
OUT=${OUTDIR:-/mnt/d/snaptiles-models/quarantine/original/runs/drive}
mkdir -p "$OUT"
for f in Land.x Basic.txt System.rcs; do [ -f "$RES/$f.orig" ] || cp "$RES/$f" "$RES/$f.orig"; done
LAND_BASE=150 LAND_CELL=50 python3 "$D/make_land.py" "$D/terrains.json" wide /tmp/land_wide.body >/dev/null
{ head -127 "$RES/Land.x.orig"; cat /tmp/land_wide.body; } > "$RES/Land.x"
sed "s/\r//" "$D/${HARNESS:-harness_drive.rcs}" > "$RES/System.rcs"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
while IFS=$'\t' read -r n path; do
  for mode in idle up; do
    [ -f "$OUT/$n.$mode.csv" ] && continue
    cp "$RAW/$path" "$RES/Basic.txt"; rm -f "$RES/log.txt"
    ( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
    WPID=$!
    sleep 5
    WID=$(xdotool search --name "Rigid" | head -1)
    [ -n "$WID" ] && xdotool windowactivate --sync "$WID" 2>/dev/null
    [ "$mode" = up ] && xdotool keydown Up
    for i in $(seq 1 60); do sleep 0.5; [ -f "$RES/log.txt" ] && break; done
    [ "$mode" = up ] && xdotool keyup Up
    sleep 0.5
    kill $WPID 2>/dev/null; sleep 0.5; wineserver -k 2>/dev/null; sleep 0.5
    cp "$RES/log.txt" "$OUT/$n.$mode.csv" 2>/dev/null || echo "$n $mode: no log ($path)"
  done
done < <(if [ -n "${INDEX:-}" ]; then grep -P "^(${INDEX})	" "$G/index.tsv"; else cat "$G/index.tsv"; fi)
kill $XPID 2>/dev/null
for f in Land.x Basic.txt System.rcs; do cp "$RES/$f.orig" "$RES/$f"; done
echo "corpus driving done: $(ls "$OUT"/*.csv 2>/dev/null | wc -l) logs"
