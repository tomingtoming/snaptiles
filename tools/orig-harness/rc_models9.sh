#!/bin/bash
# rolling drag car v2: big wheels (option 2, r 0.6) lift the body 0.9 m so a jet folded down at the nose
# stays clear of the ground; long wheelbase; plates on the tail at 0/30/60/90 degrees. Thrust 1667 N.
M=$HOME/rc/models
mk() { printf 'Val { Engine(default=%s,min=-100000,max=100000) }\nKey { }\nBody { %s }\n' "$2" "$3" > "$M/$1.txt"; }
for a in 0 30 60 90; do
  mk "rollb_$a" 10000 "Core(){ N:Chip(){ N:Jet(angle=90,power=Engine){ } W:Frame(){ W:Wheel(angle=90,option=2){ } } E:Frame(){ E:Wheel(angle=90,option=2){ } } } S:Chip(){ S:Chip(){ W:Frame(){ W:Wheel(angle=90,option=2){ } } E:Frame(){ E:Wheel(angle=90,option=2){ } } S:Chip(angle=$a){ S:Chip(){ } } } } }"
done
ls "$M"/rollb_*.txt | wc -l
