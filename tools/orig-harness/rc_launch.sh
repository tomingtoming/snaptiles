#!/bin/bash
# Launch RigidChips 1.5B26 under wine on a virtual X display and take screenshots.
# usage: rc_launch.sh <seconds-before-shot> [extra args for the exe]
set -u
SECS=${1:-12}; shift || true
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32
export WINEDEBUG=-all,+err
OUT=/mnt/d/snaptiles-models/quarantine/shots
mkdir -p "$OUT" ~/rc/log
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
cd ~/rc/RC15B26
wine ./RigidChips15B26.exe "$@" >~/rc/log/wine.log 2>&1 &
WPID=$!
sleep "$SECS"
echo "--- windows:"; xdotool search --onlyvisible --name '' getwindowname %@ 2>/dev/null | head
echo "--- xwininfo root tree:"; xwininfo -root -tree | grep -E '^\s+0x' | head -8
TS=$(date +%H%M%S)
xwd -root -silent | convert xwd:- "$OUT/rc_$TS.png" && echo "shot $OUT/rc_$TS.png"
if kill -0 $WPID 2>/dev/null; then echo "wine still running"; else echo "wine exited"; fi
echo "--- wine.log (last 25):"; tail -25 ~/rc/log/wine.log
kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null
