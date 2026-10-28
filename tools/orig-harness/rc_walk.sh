#!/bin/bash
# corpus walkers on the original: hold Up (key 0) from 4 s to 18 s, log the core (harness_turn3, frame 600), screenshot
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
RC=$HOME/rc/RC15B26; RES=$RC/Resources; OUT=/mnt/d/snaptiles-models/quarantine/original/runs; M=$HOME/rc/models
sed "s/\r//" /mnt/c/Users/toming/AppData/Local/Temp/harness_turn3.rcs > "$RES/System.rcs"
for spec in "$@"; do
  IFS=: read -r name model <<< "$spec"
  cp "$M/$model" "$RES/Basic.txt"; rm -f "$RES/log.txt"
  export DISPLAY=:99
  Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 & XPID=$!
  sleep 1
  ( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) & WPID=$!
  sleep 5
  WID=$(xdotool search --name "Rigid" | head -1); [ -n "$WID" ] && xdotool windowactivate --sync "$WID" 2>/dev/null; xdotool mousemove 300 300 click 1
  xdotool keydown Up; sleep 14; xdotool keyup Up
  xwd -root -silent | convert xwd:- "$OUT/$name.png" 2>/dev/null
  sleep 4
  kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null; sleep 1
  if cp "$RES/log.txt" "$OUT/$name.csv" 2>/dev/null; then echo "$name: log $(wc -l < "$OUT/$name.csv") lines"; else echo "$name: NO LOG"; fi
done
cp "$RES/Basic.txt.orig" "$RES/Basic.txt"; cp "$RES/System.rcs.orig" "$RES/System.rcs"
