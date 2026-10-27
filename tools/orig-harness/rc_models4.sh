#!/bin/bash
# jet probes with Val-bound power: the plane sample at full throttle, and a flat jet driven by a Val default
M=$HOME/rc/models
sed 's/Jet(default=0,min=-35000,max=35000,step=2000)/Jet(default=35000,min=-35000,max=35000,step=2000)/' "$M/data_plane.txt" > "$M/plane_full.txt"
grep -c "default=35000" "$M/plane_full.txt"
printf 'Val { Engine(default=20000,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Jet(angle=0,power=Engine){ } S:Chip(){ } } }\n' > "$M/jet_flat_val.txt"
printf 'Val { Engine(default=20000,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Frame(){ N:Jet(angle=90,power=Engine){ } } S:Chip(){ } } }\n' > "$M/jet_frame_val.txt"
ls -l "$M/plane_full.txt" "$M/jet_flat_val.txt" "$M/jet_frame_val.txt"
