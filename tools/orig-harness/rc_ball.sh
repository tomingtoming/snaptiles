#!/bin/bash
# press H (add ball) on the original and screenshot: ball size and placement
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
RC=$HOME/rc/RC15B26; RES=$RC/Resources; OUT=/mnt/d/snaptiles-models/quarantine/original/runs
cp "$RES/Basic.txt.orig" "$RES/Basic.txt"; cp "$RES/System.rcs.orig" "$RES/System.rcs"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 & XPID=$!
sleep 1
( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) & WPID=$!
sleep 8
WID=$(xdotool search --name "Rigid" | head -1); [ -n "$WID" ] && xdotool windowactivate --sync "$WID" 2>/dev/null; xdotool mousemove 300 300 click 1
xdotool key h; sleep 1; xwd -root -silent | convert xwd:- "$OUT/ball1.png" 2>/dev/null
xdotool key h; sleep 0.5; xdotool key h; sleep 3; xwd -root -silent | convert xwd:- "$OUT/ball3.png" 2>/dev/null
kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null; sleep 1
echo ball-done
