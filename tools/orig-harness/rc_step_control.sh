#!/bin/bash
# Control for the step probe: the self-driving Basic car (Engine default P) on the original's default land.
M=$HOME/rc/models; P=${1:-2500}
sed "s/Engine(default=0,/Engine(default=$P,/; s/max=2500,step=2500/max=2500,step=0/" "$M/basic.txt" > "$M/basic_drive_$P.txt"
grep -o "Engine(default=[^)]*)" "$M/basic_drive_$P.txt"
bash "$(dirname "$0")/rc_camera.sh" basicdrive_default "$M/basic_drive_$P.txt" 30 VIEWSET=0
