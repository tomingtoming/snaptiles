#!/bin/bash
# jet thrust per power: a Core between two flat Jets (N and S, 98.7 kg, weight 968 N), each at power P from frame 60.
# At 1/6 N per power it lifts above P=2904, at 0.145 above 3338.
M=$HOME/rc/models
for p in 2800 3000 3200 3400; do
printf 'Val { P(default=0,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Jet(power=P){ } S:Jet(power=P){ } } }\nLua {\nfunction OnFrame()\n  if _TICKS()>=60 then P=%s end\nend\n}\n' $p > "$M/jetlift2_$p.txt"
done
