#!/bin/bash
# Ground contact stiffness: flat plate models resting on the "wide" land (150 m base), no input, 20 s.
# Models are written here; logs go to runs/ground/<name>.csv (harness_drive.rcs columns).
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
D=$(cd "$(dirname "$0")" && pwd); RC=$HOME/rc/RC15B26; RES=$RC/Resources
OUT=/mnt/d/snaptiles-models/quarantine/original/runs/ground
mkdir -p "$OUT/models"
mk() { printf 'Val { A(default=0) }\nKey { }\nBody { Core(){ %s } }\n' "$2" > "$OUT/models/$1.txt"; }
mk g_core ''
mk g_5chip 'N:Chip(){ } S:Chip(){ } E:Chip(){ } W:Chip(){ }'
mk g_5frame 'N:Frame(){ } S:Frame(){ } E:Frame(){ } W:Frame(){ }'
mk g_5w 'N:Weight(){ } S:Weight(){ } E:Weight(){ } W:Weight(){ }'
mk g_9w 'N:Weight(){ W:Weight(){ } E:Weight(){ } } S:Weight(){ W:Weight(){ } E:Weight(){ } } E:Weight(){ } W:Weight(){ }'
mk g_25w 'N:Weight(){ W:Weight(){ W:Weight(){ } } E:Weight(){ E:Weight(){ } } N:Weight(){ W:Weight(){ W:Weight(){ } } E:Weight(){ E:Weight(){ } } } } S:Weight(){ W:Weight(){ W:Weight(){ } } E:Weight(){ E:Weight(){ } } S:Weight(){ W:Weight(){ W:Weight(){ } } E:Weight(){ E:Weight(){ } } } } E:Weight(){ E:Weight(){ } } W:Weight(){ W:Weight(){ } }'
mk t_n30 'N:Chip(angle=30){ } S:Chip(angle=30){ }'
mk t_n60 'N:Chip(angle=60){ } S:Chip(angle=60){ }'
mk t_m30 'N:Chip(angle=-30){ } S:Chip(angle=-30){ }'
mk t_m60 'N:Chip(angle=-60){ } S:Chip(angle=-60){ }'
mk t_w60 'N:Chip(angle=60){ } S:Chip(angle=60){ } E:Weight(){ } W:Weight(){ }'
mk t_f60 'N:Frame(angle=60){ } S:Frame(angle=60){ }'
mk t_a60 'N:Arm(angle=60){ } S:Arm(angle=60){ }'
mk t_c60 'N:Chip(angle=60){ N:Chip(){ } } S:Chip(angle=60){ S:Chip(){ } }'
for f in "$OUT"/models/*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
for f in Land.x Basic.txt System.rcs; do [ -f "$RES/$f.orig" ] || cp "$RES/$f" "$RES/$f.orig"; done
LAND_BASE=150 LAND_CELL=50 python3 "$D/make_land.py" "$D/terrains.json" wide /tmp/land_wide.body >/dev/null
{ head -127 "$RES/Land.x.orig"; cat /tmp/land_wide.body; } > "$RES/Land.x"
sed "s/\r//" "$D/harness_drive.rcs" > "$RES/System.rcs"
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
for f in "$OUT"/models/*.txt; do
  n=$(basename "$f" .txt); [ -f "$OUT/$n.csv" ] && continue
  cp "$f" "$RES/Basic.txt"; rm -f "$RES/log.txt"
  ( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
  WPID=$!
  for i in $(seq 1 70); do sleep 0.5; [ -f "$RES/log.txt" ] && break; done
  sleep 0.5
  kill $WPID 2>/dev/null; sleep 0.5; wineserver -k 2>/dev/null; sleep 0.5
  cp "$RES/log.txt" "$OUT/$n.csv" 2>/dev/null || echo "$n: no log"
done
kill $XPID 2>/dev/null
for f in Land.x Basic.txt System.rcs; do cp "$RES/$f.orig" "$RES/$f"; done
