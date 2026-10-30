#!/bin/bash
# Camera probe models: a car circling at constant power and steering from frame 0, and a parked car.
M=$HOME/rc/models
sed "s/if t>=150 then HANDLE=20 else HANDLE=0 end/HANDLE=15/" "$M/turn_a20_p2500.txt" > "$M/cam_circle.txt"
sed "s/Engine(default=2500/Engine(default=0/" "$M/cam_circle.txt" > "$M/cam_parked.txt"
grep -c "HANDLE=15" "$M/cam_circle.txt" "$M/cam_parked.txt"; grep -o "Engine(default=[0-9]*" "$M/cam_parked.txt"
