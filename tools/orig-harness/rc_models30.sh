#!/bin/bash
# small-angle plate aero on the rolling car: tail plates at 5, 8, 10 degrees (and -10: tilted the other way)
M=$HOME/rc/models
mk() { printf 'Val { Engine(default=%s,min=-100000,max=100000) }\nKey { }\nBody { %s }\n' "$2" "$3" > "$M/$1.txt"; }
for a in 5 8 10 -10; do
  mk "rollb_$a" 10000 "Core(){ N:Chip(){ N:Jet(angle=90,power=Engine){ } W:Frame(){ W:Wheel(angle=90,option=2){ } } E:Frame(){ E:Wheel(angle=90,option=2){ } } } S:Chip(){ S:Chip(){ W:Frame(){ W:Wheel(angle=90,option=2){ } } E:Frame(){ E:Wheel(angle=90,option=2){ } } S:Chip(angle=$a){ S:Chip(){ } } } } }"
done
ls "$M"/rollb_*.txt | wc -l
