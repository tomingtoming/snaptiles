#!/bin/bash
# edge friction: the fric_* sled (rc_models14.sh, jet power 10000 from the start) riding on the outer edges of its
# W/E plates folded down 60° or 30° (like a bike's side stands, edges along the motion)
M=$HOME/rc/models
mk() { printf 'Val { Engine(default=10000,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Chip(){ N:Jet(angle=-90,power=Engine){ } } S:Chip(){ S:Chip(){ } } W:%s(angle=-%s){ } E:%s(angle=-%s){ } } }\n' "$2" "$3" "$2" "$3" > "$M/$1.txt"; }
for t in Frame Chip Weight; do for a in 60 30; do mk "edge_${t}_$a" $t $a; done; done
