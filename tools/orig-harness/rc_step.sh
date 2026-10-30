#!/bin/bash
# Step probe on the original: swap Resources/Land.x for a flat land with a step (lands/step_<h>.body after
# the original's template block), run the self-driving Basic car with harness_step.rcs, restore everything.
# usage: rc_step.sh <name> <step height, e.g. 0.10> <engine power>
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
D=$(dirname "$0"); RC=$HOME/rc/RC15B26; RES=$RC/Resources; M=$HOME/rc/models
OUT=/mnt/d/snaptiles-models/quarantine/original/runs/step
mkdir -p "$OUT"
name=$1 h=$2 p=$3
[ -f "$RES/Land.x.orig" ] || cp "$RES/Land.x" "$RES/Land.x.orig"
[ -f "$RES/Basic.txt.orig" ] || cp "$RES/Basic.txt" "$RES/Basic.txt.orig"
[ -f "$RES/System.rcs.orig" ] || cp "$RES/System.rcs" "$RES/System.rcs.orig"
{ head -127 "$RES/Land.x.orig"; cat "$D/lands/step_$h.body"; } > "$RES/Land.x"
sed "s/Engine(default=0,/Engine(default=$p,/; s/max=2500,step=2500/max=2500,step=0/" "$M/basic.txt" > "$RES/Basic.txt"
sed "s/\r//" "$D/harness_step.rcs" > "$RES/System.rcs"
rm -f "$RES/log.txt"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
WPID=$!
for s in 6 9 12 18; do sleep $(( s - ${prev:-0} )); prev=$s; xwd -root -silent | convert xwd:- "$OUT/${name}_$s.png" 2>/dev/null; done
sleep 8
kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null; sleep 1
if cp "$RES/log.txt" "$OUT/$name.csv" 2>/dev/null; then echo "$name: log $(wc -l < "$OUT/$name.csv") lines"; else echo "$name: NO LOG"; fi
cp "$RES/Land.x.orig" "$RES/Land.x"; cp "$RES/Basic.txt.orig" "$RES/Basic.txt"; cp "$RES/System.rcs.orig" "$RES/System.rcs"
