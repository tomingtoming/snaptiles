#!/bin/bash
# Existing quarantined original only. Usage: run_probe.sh model harness log-name output.csv
set -euo pipefail
[ "$#" -eq 4 ] || { echo 'usage: run_probe.sh model harness log-name output.csv' >&2; exit 2; }
model=$(realpath "$1"); harness=$(realpath "$2"); log=$3; output=$(realpath -m "$4")
case "$log" in */*|*..*) echo 'log-name must be a simple filename' >&2; exit 2;; esac
if pgrep -f '[R]igidChips15B26.exe' >/dev/null; then echo 'An original instance is already running; leave it untouched.' >&2; exit 3; fi
export WINEPREFIX=$HOME/.wine-rc WINEARCH=win32 WINEDEBUG=-all
rc=$HOME/rc/RC15B26
backup=$(mktemp -d)
cp "$rc/Resources/Basic.txt" "$backup/Basic.txt"
cp "$rc/Resources/System.rcs" "$backup/System.rcs"
restore() { cp "$backup/Basic.txt" "$rc/Resources/Basic.txt"; cp "$backup/System.rcs" "$rc/Resources/System.rcs"; }
trap restore EXIT
cp "$model" "$rc/Resources/Basic.txt"
sed 's/\r$//' "$harness" > "$rc/Resources/System.rcs"
touch "$backup/start"
cd "$rc"
status=0
xvfb-run -a timeout --signal=TERM --kill-after=3s 12s wine ./RigidChips15B26.exe >/dev/null 2>&1 || status=$?
[ "$status" -eq 0 ] || [ "$status" -eq 124 ] || exit "$status"
[ "Resources/$log" -nt "$backup/start" ] || { echo 'No fresh measurement; refusing stale output' >&2; exit 4; }
cp "Resources/$log" "$output"
printf 'Saved %s\n' "$output"
