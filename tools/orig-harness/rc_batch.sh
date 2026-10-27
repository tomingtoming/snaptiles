#!/bin/bash
# Batch measurement runs of the original RigidChips 1.5B26 under wine/Xvfb.
# Each case: <name>:<model-file>:<power>. Model is copied over Resources/Basic.txt (the default model),
# the harness scenario's 2500 is replaced by <power>, the exe runs 15 s, log/geom are copied out.
# HARNESS=<path to .rcs> overrides the scenario.
set -u
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
RC=$HOME/rc/RC15B26
RES=$RC/Resources
OUT=/mnt/d/snaptiles-models/quarantine/original/runs
HARNESS=${HARNESS:-/mnt/c/Users/toming/AppData/Local/Temp/harness_System.rcs}
M=$HOME/rc/models
mkdir -p "$OUT" "$M"
[ -f "$RES/Basic.txt.orig" ] || cp "$RES/Basic.txt" "$RES/Basic.txt.orig"
[ -f "$RES/System.rcs.orig" ] || cp "$RES/System.rcs" "$RES/System.rcs.orig"

# model variants
iconv -f CP932 -t UTF-8 "$RES/Basic.txt.orig" > "$M/basic.txt"
sed 's/Wheel(angle=90,/Wheel(angle=90,option=1,/' "$M/basic.txt" > "$M/basic_opt1.txt"
sed 's/Wheel(angle=90,/Wheel(angle=90,option=2,/' "$M/basic.txt" > "$M/basic_opt2.txt"
# minimal models keep the Val/Key blocks of Basic (a model without Key{} crashed the exe)
head_blocks() { sed -n '1,/^Body/p' "$M/basic.txt" | sed '$d'; }
{ head_blocks; echo 'Body { Core(){ } }'; } > "$M/core_only.txt"
{ head_blocks; echo 'Body { Core(){ N:Chip(){ } } }'; } > "$M/core_chip.txt"
for f in "$RC"/Data/*.txt; do b=$(basename "$f" .txt); iconv -f CP932 -t UTF-8 "$f" > "$M/data_$b.txt" 2>/dev/null; done
cp "$M/data_Cube.txt" "$M/cube.txt"

run_case() {
  local name=$1 model=$2 power=$3 secs=${4:-15}
  cp "$model" "$RES/Basic.txt"
  sed "s/\r//; s/p=-2500/p=-$power/; s/p=2500/p=$power/" "$HARNESS" > "$RES/System.rcs"
  rm -f "$RES/log.txt" "$RES/geom.txt"
  export DISPLAY=:99
  Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
  local xpid=$!
  sleep 1
  ( cd "$RC" && wine ./RigidChips15B26.exe >/dev/null 2>&1 ) &
  local wpid=$!
  sleep "$secs"
  xwd -root -silent | convert xwd:- "$OUT/$name.png" 2>/dev/null
  kill $wpid 2>/dev/null; sleep 1; wineserver -k 2>/dev/null; kill $xpid 2>/dev/null; sleep 1
  if cp "$RES/log.txt" "$OUT/$name.csv" 2>/dev/null; then echo "$name: log $(wc -l < "$OUT/$name.csv") lines"; else echo "$name: NO LOG"; fi
  cp "$RES/geom.txt" "$OUT/$name.geom.csv" 2>/dev/null
}

for spec in "$@"; do
  IFS=: read -r name model power <<< "$spec"
  run_case "$name" "$M/$model" "$power"
done
cp "$RES/Basic.txt.orig" "$RES/Basic.txt"
