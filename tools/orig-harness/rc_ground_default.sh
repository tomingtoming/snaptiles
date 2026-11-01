#!/bin/bash
# The ground probes of rc_ground.sh on the original's default land (harness_servo2.rcs: chips 0..9 every frame).
M=/mnt/d/snaptiles-models/quarantine/original/runs/ground/models
L=""
for n in "$@"; do cp "$M/$n.txt" "$HOME/rc/models/gd_$n.txt"; L="$L gd_$n:gd_$n.txt:0"; done
HARNESS=/mnt/d/snaptiles/tools/orig-harness/harness_servo2.rcs bash /mnt/d/snaptiles/tools/orig-harness/rc_batch.sh $L
