#!/bin/bash
# Screenshot the original's menus (to read their keyboard shortcuts). usage: rc_menu.sh <x> <y> <name> [<x2> <y2> <name2> ...]
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
RC=$HOME/rc/RC15B26
OUT=/mnt/d/snaptiles-models/quarantine/original/runs/camera
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
WPID=$!
sleep 8
while [ $# -ge 3 ]; do
  xdotool mousemove "$1" "$2" click 1; sleep 1.5
  xwd -root -silent | convert xwd:- "$OUT/menu_$3.png" 2>/dev/null
  xdotool key Escape; sleep 0.5; xdotool key Escape; sleep 0.5
  shift 3
done
kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null
