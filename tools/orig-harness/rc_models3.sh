#!/bin/bash
# constant-power probe models (attributes bound to a Val are re-evaluated every frame and override _SET)
M=$HOME/rc/models
head_blocks() { sed -n '1,/^Body/p' "$M/basic.txt" | sed '$d'; }
for p in 5000 20000 -5000; do
  { head_blocks; echo "Body { Core(){ N:Jet(angle=0,power=$p){ } S:Chip(){ } } }"; } > "$M/jet_flat_c$p.txt"
done
{ head_blocks; echo 'Body { Core(){ N:Chip(){ N:Jet(angle=90,power=5000){ } } S:Chip(){ } } }'; } > "$M/jet_fold90_c5000.txt"
{ head_blocks; echo 'Body { Core(){ N:Chip(){ N:Jet(angle=-90,power=5000){ } } S:Chip(){ } } }'; } > "$M/jet_foldm90_c5000.txt"
# Basic with the rear wheels' power=Engine removed (all four wheels then take _SET POWER)
sed 's/power=Engine,//; s/power=-Engine,//' "$M/basic.txt" > "$M/basic_nopower.txt"
grep -c "power=" "$M/basic_nopower.txt"
ls "$M" | grep -c .
