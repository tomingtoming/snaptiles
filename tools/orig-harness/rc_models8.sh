#!/bin/bash
# rolling drag car: the jet sits above the body (chip folded up, jet folded forward) so nothing but the
# tyres touches the ground; plates on S at 0/30/60/90 degrees. Thrust 3333 N.
M=$HOME/rc/models
mk() { printf 'Val { Engine(default=%s,min=-100000,max=100000) }\nKey { }\nBody { %s }\n' "$2" "$3" > "$M/$1.txt"; }
for a in 0 30 60 90; do
  mk "roll_$a" 20000 "Core(){ N:Chip(angle=-90){ N:Jet(angle=90,power=Engine){ } } W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } S:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } S:Chip(angle=$a){ S:Chip(){ } } } }"
done
ls "$M"/roll_*.txt | wc -l
