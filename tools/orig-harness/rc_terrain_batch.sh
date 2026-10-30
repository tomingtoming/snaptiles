#!/bin/bash
# Every scene of terrains.json at Engine 2500 (tier 1 of the 2026-10-31 difference hunt).
D=$(cd "$(dirname "$0")" && pwd)
for s in $(python3 -c "import json;print(' '.join(k for k in json.load(open('$D/terrains.json'))['scenes']))"); do bash "$D/rc_terrain.sh" "$s" 2500; done
