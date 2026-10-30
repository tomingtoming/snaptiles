#!/bin/bash
# Camera probe of the original RigidChips 1.5B26 (wine/Xvfb). usage:
#   rc_camera.sh <name> <model-file> <seconds> [VIEWSET=0|1] [key@second ...]
# Copies the model over Basic.txt, runs harness_camera.rcs, screenshots every 3 s, optionally presses
# keys (xdotool names, e.g. F2@12) at seconds after launch; log/shots go to the runs folder.
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
RC=$HOME/rc/RC15B26
RES=$RC/Resources
OUT=/mnt/d/snaptiles-models/quarantine/original/runs/camera
H=$(dirname "$0")/harness_camera.rcs
mkdir -p "$OUT"
name=$1 model=$2 secs=$3; shift 3
viewset=1
[ "${1:-}" = "VIEWSET=0" ] && { viewset=0; shift; }
[ -f "$RES/Basic.txt.orig" ] || cp "$RES/Basic.txt" "$RES/Basic.txt.orig"
[ -f "$RES/System.rcs.orig" ] || cp "$RES/System.rcs" "$RES/System.rcs.orig"
cp "$model" "$RES/Basic.txt"
sed "s/\r//; s/^VIEWSET=1/VIEWSET=$viewset/" "$H" > "$RES/System.rcs"
rm -f "$RES/log.txt"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
WPID=$!
T0=$(date +%s)
sleep 6
WID=$(xdotool search --name "Rigid" | head -1)
[ -n "$WID" ] && xdotool windowactivate --sync "$WID" 2>/dev/null
xdotool mousemove 640 400 click 1
declare -A press
for spec in "$@"; do press[${spec#*@}]+="${spec%@*} "; done
for ((s=6; s<secs; s++)); do
  for k in ${press[$s]:-}; do xdotool key "$k"; done
  if (( s % 3 == 0 )); then xwd -root -silent | convert xwd:- "$OUT/${name}_$(printf %02d $s).png" 2>/dev/null; fi
  sleep 1
done
kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null; sleep 1
if cp "$RES/log.txt" "$OUT/$name.csv" 2>/dev/null; then echo "$name: log $(wc -l < "$OUT/$name.csv") lines"; else echo "$name: NO LOG"; fi
cp "$RES/Basic.txt.orig" "$RES/Basic.txt"; cp "$RES/System.rcs.orig" "$RES/System.rcs"
