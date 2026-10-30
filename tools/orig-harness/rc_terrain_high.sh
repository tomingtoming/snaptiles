#!/bin/bash
# Re-run the scenes that dropped below the original's sea at the default 50 m base, on a 150 m base.
D=$(cd "$(dirname "$0")" && pwd)
for s in drop100 ramp30 drop050 ditch; do LAND_BASE=150 bash "$D/rc_terrain.sh" "$s" 2500; done
