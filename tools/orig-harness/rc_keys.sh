#!/bin/bash
# Measure the original's default key table: run the exe with harness_keys.rcs (logs _KEY(0..39) per frame),
# press one key per second with xdotool, and read which key number lights up in which second.
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
RC=$HOME/rc/RC15B26
RES=$RC/Resources
OUT=/mnt/d/snaptiles-models/quarantine/original/runs
[ -f "$RES/System.rcs.orig" ] || cp "$RES/System.rcs" "$RES/System.rcs.orig"
[ -f "$RES/Basic.txt.orig" ] || cp "$RES/Basic.txt" "$RES/Basic.txt.orig"
cp "$RES/Basic.txt.orig" "$RES/Basic.txt"
sed "s/\r//" /mnt/c/Users/toming/AppData/Local/Temp/harness_keys.rcs > "$RES/System.rcs"
rm -f "$RES/log.txt"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
WPID=$!
sleep 8
# focus the game window
WID=$(xdotool search --name "Rigid" | head -1)
echo "window $WID"
[ -n "$WID" ] && xdotool windowactivate --sync "$WID" 2>/dev/null; xdotool mousemove 300 300 click 1
KEYS="Up Down Left Right z x c a s d v b f g q w e t y i o p k l n m 1 2 3 4 5 6 7 8 9 0 space Return shift ctrl alt Tab F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 minus equal bracketleft bracketright semicolon apostrophe comma period slash backslash grave BackSpace Delete Insert Home End Prior Next KP_1 KP_2 KP_3 KP_4 KP_5 KP_6 KP_7 KP_8 KP_9 KP_0"
T0=$(date +%s.%N)
echo "t0 $T0" > "$OUT/keys_schedule.txt"
i=0
for k in $KEYS; do
  now=$(date +%s.%N)
  echo "$k $(awk -v a=$now -v b=$T0 "BEGIN{print a-b}")" >> "$OUT/keys_schedule.txt"
  xdotool keydown "$k"; sleep 0.4; xdotool keyup "$k"; sleep 0.35
  i=$((i+1))
done
# wait for the log (frame 1500 at 30 fps = 50 s after start)
sleep 24
xwd -root -silent | convert xwd:- "$OUT/keys.png" 2>/dev/null
kill $WPID 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $XPID 2>/dev/null; sleep 1
if cp "$RES/log.txt" "$OUT/keys.csv" 2>/dev/null; then echo "keys: log $(wc -l < "$OUT/keys.csv") lines"; else echo "keys: NO LOG"; fi
cp "$RES/System.rcs.orig" "$RES/System.rcs"
