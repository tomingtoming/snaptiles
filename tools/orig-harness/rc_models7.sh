#!/bin/bash
# drag sled: wide base (W/E chips + Weight ballast) so the plate on S cannot flip it; thrust 3333 N
M=$HOME/rc/models
mk() { printf 'Val { Engine(default=%s,min=-100000,max=100000) }\nKey { }\nBody { %s }\n' "$2" "$3" > "$M/$1.txt"; }
for a in 90 60 30 15 0; do
  mk "sled_$a" 20000 "Core(){ N:Jet(angle=90,power=Engine){ } W:Chip(){ W:Weight(){ } } E:Chip(){ E:Weight(){ } } S:Chip(){ S:Chip(angle=$a){ S:Chip(){ } } } }"
done
ls "$M"/sled_*.txt | wc -l
