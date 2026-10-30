#!/bin/bash
# Terrain probe on the original: build Resources/Land.x from one scene of terrains.json (make_land.py after the
# original's template block), drive the self-driving Basic car (Engine P) with harness_step.rcs, restore all.
# usage: rc_terrain.sh <scene> [engine power, default 2500] [seconds, default 24]
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
D=$(cd "$(dirname "$0")" && pwd); RC=$HOME/rc/RC15B26; RES=$RC/Resources; M=$HOME/rc/models
OUT=/mnt/d/snaptiles-models/quarantine/original/runs/terrain
mkdir -p "$OUT"
scene=$1 p=${2:-2500} secs=${3:-24}
[ -f "$RES/Land.x.orig" ] || cp "$RES/Land.x" "$RES/Land.x.orig"
[ -f "$RES/Basic.txt.orig" ] || cp "$RES/Basic.txt" "$RES/Basic.txt.orig"
[ -f "$RES/System.rcs.orig" ] || cp "$RES/System.rcs" "$RES/System.rcs.orig"
LAND_BASE=${LAND_BASE:-50} python3 "$D/make_land.py" "$D/terrains.json" "$scene" /tmp/land_$scene.body >/dev/null
{ head -127 "$RES/Land.x.orig"; cat /tmp/land_$scene.body; } > "$RES/Land.x"
sed "s/Engine(default=0,/Engine(default=$p,/; s/max=2500,step=2500/max=2500,step=0/" "$M/basic.txt" > "$RES/Basic.txt"
sed "s/\r//" "$D/harness_step.rcs" > "$RES/System.rcs"
rm -f "$RES/log.txt"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
WPID=$!
sleep 10; xwd -root -silent | convert xwd:- "$OUT/${scene}_p${p}.png" 2>/dev/null
sleep $((secs - 10))
kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null; sleep 1
if cp "$RES/log.txt" "$OUT/${scene}_p${p}${LAND_BASE:+_b$LAND_BASE}.csv" 2>/dev/null; then echo "$scene: log $(wc -l < "$OUT/${scene}_p${p}.csv") lines"; else echo "$scene: NO LOG"; fi
cp "$RES/Land.x.orig" "$RES/Land.x"; cp "$RES/Basic.txt.orig" "$RES/Basic.txt"; cp "$RES/System.rcs.orig" "$RES/System.rcs"
