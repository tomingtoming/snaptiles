#!/bin/bash
# Static geometry of hand-made variants: rc_geom_one.sh <out dir> <name> ... where <out dir>/models/<name>.txt is UTF-8.
# Writes <out dir>/<name>.g1.csv / .g30.csv (harness_geom2.rcs) and appends <name> to <out dir>/index.tsv.
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
D=$(cd "$(dirname "$0")" && pwd); RC=$HOME/rc/RC15B26; RES=$RC/Resources
OUT=$1; shift
[ -f "$RES/Basic.txt.orig" ] || cp "$RES/Basic.txt" "$RES/Basic.txt.orig"
[ -f "$RES/System.rcs.orig" ] || cp "$RES/System.rcs" "$RES/System.rcs.orig"
sed "s/\r//" "$D/harness_geom2.rcs" > "$RES/System.rcs"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
for n in "$@"; do
  grep -q "^$n	" "$OUT/index.tsv" 2>/dev/null || printf '%s\t%s\n' "$n" "variant/$n" >> "$OUT/index.tsv"
  iconv -f UTF-8 -t CP932 "$OUT/models/$n.txt" > "$RES/Basic.txt"; rm -f "$RES/geom1.txt" "$RES/geom30.txt"
  ( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
  WPID=$!
  for i in $(seq 1 50); do sleep 0.5; [ -f "$RES/geom30.txt" ] && break; done
  sleep 0.5
  kill $WPID 2>/dev/null; sleep 0.5; wineserver -k 2>/dev/null; sleep 0.5
  cp "$RES/geom1.txt" "$OUT/$n.g1.csv" 2>/dev/null; cp "$RES/geom30.txt" "$OUT/$n.g30.csv" 2>/dev/null || echo "$n: no geometry"
done
kill $XPID 2>/dev/null
cp "$RES/Basic.txt.orig" "$RES/Basic.txt"; cp "$RES/System.rcs.orig" "$RES/System.rcs"
