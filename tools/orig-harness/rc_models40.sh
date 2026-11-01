#!/bin/bash
# balloon jets: two Jets (option 1 or 2) beside a Core at power 4000 each from frame 60 (as plain jets that lifts:
# rc_models37.sh lifts the same body at 3000)
M=$HOME/rc/models
for o in 1 2; do
printf 'Val { P(default=0,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Jet(power=P,option=%s){ } S:Jet(power=P,option=%s){ } } }\nLua {\nfunction OnFrame()\n  if _TICKS()>=60 then P=4000 end\nend\n}\n' $o $o > "$M/balloon_o$o.txt"
done
