#!/bin/bash
# wheel mass by option: the HUD prints _WEIGHT() of a Core with four wheels
M=$HOME/rc/models
for k in 0 1 2; do
  printf 'Val { }\nKey { }\nBody { Core(){ N:Chip(){ W:Wheel(angle=90,option=%s){ } E:Wheel(angle=90,option=%s){ } } S:Chip(){ W:Wheel(angle=90,option=%s){ } E:Wheel(angle=90,option=%s){ } } } }\nScript {\n\tprint 0,"WEIGHT=",_WEIGHT()," CHIPS=",_CHIPS()\n}\n' $k $k $k $k > "$M/wheelmass_$k.txt"
done
ls "$M"/wheelmass_*.txt | wc -l
