#!/bin/bash
# After an interrupted probe: list what is left (this user only), stop this prefix's wine via wineserver,
# and restore the swapped Resources files. Stray Xvfb/bash processes are listed, not killed: stop them by PID.
export WINEPREFIX=$HOME/.wine-rc
RES=$HOME/rc/RC15B26/Resources
ps -u "$USER" -o pid,etime,cmd | grep -E 'Xvfb|rc_|RigidChips|wine' | grep -v grep
wineserver -k 2>/dev/null
for f in Land.x Basic.txt System.rcs; do [ -f "$RES/$f.orig" ] && cp "$RES/$f.orig" "$RES/$f"; done
echo "land restored: $(cmp -s "$RES/Land.x" "$RES/Land.x.orig" && echo yes || echo no)"
