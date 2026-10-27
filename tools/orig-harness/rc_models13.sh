#!/bin/bash
# thrust vs rolling loss: the same jet-pushed car with option 0 and option 2 wheels, and the jet car on
# no wheels but hanging in the air is impossible, so also a 'sled with wheels option 0' at two thrusts.
M=$HOME/rc/models
mk() { printf 'Val { Engine(default=%s,min=-100000,max=100000) }\nKey { }\nBody { %s }\nScript {\n\tprint 0,"WEIGHT=",_WEIGHT()\n}\n' "$2" "$3" > "$M/$1.txt"; }
CAR0='Core(){ N:Chip(){ N:Jet(angle=-90,power=Engine){ } W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } S:Chip(){ S:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } S:Chip(){ } } } }'
mk rolle_opt0_10000 10000 "$CAR0"
mk rolle_opt0_5000 5000 "$CAR0"
CAR2=$(echo "$CAR0" | sed 's/Wheel(angle=90)/Wheel(angle=90,option=2)/g')
mk rolle_opt2_10000 10000 "$CAR2"
ls "$M"/rolle_*.txt | wc -l; grep -c option=2 "$M/rolle_opt2_10000.txt"
