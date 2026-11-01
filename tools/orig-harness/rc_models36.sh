#!/bin/bash
# aero of Trim and Rudder plates on the rollb car (rc_models9.sh): two side plates pitched about the lateral axis
# (W:/E:Trim on the tail chip roll about W/E, so their angle is an angle of attack), and Chip references.
M=$HOME/rc/models
mk() { printf 'Val { Engine(default=%s,min=-100000,max=100000) }\nKey { }\nBody { %s }\n' "$2" "$3" > "$M/$1.txt"; }
car() { echo "Core(){ N:Chip(){ N:Jet(angle=90,power=Engine){ } W:Frame(){ W:Wheel(angle=90,option=2){ } } E:Frame(){ E:Wheel(angle=90,option=2){ } } } S:Chip(){ S:Chip(){ W:Frame(){ W:Wheel(angle=90,option=2){ } } E:Frame(){ E:Wheel(angle=90,option=2){ } } S:Chip(){ $1 } } } }"; }
for a in 0 30 45; do
  mk "rollt_$a" 10000 "$(car "W:Trim(angle=$a){ } E:Trim(angle=-$a){ }")"
  mk "rolltn_$a" 10000 "$(car "W:Trim(angle=-$a){ } E:Trim(angle=$a){ }")"
done
mk rollr_0 10000 "$(car "W:Rudder(angle=0){ } E:Rudder(angle=0){ }")"
mk rollc_0 10000 "$(car "W:Chip(angle=0){ } E:Chip(angle=0){ }")"
for f in "$M"/roll[tcr]*_*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
