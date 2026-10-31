#!/bin/bash
# spring/damper law on an unloaded joint: a heavy base (core + three Weights) with an arm standing up from its N edge.
# The arm's hinge A goes -90 (straight up) -> -60 at frame 150 and back to -90 at frame 240.
# arm_<spring>_<damper>[_w]: _w puts a Weight at the arm's tip (inertia ×~4) to see whether the response depends on it.
M=$HOME/rc/models
mk() { # name spring damper tip
cat > "$M/$1.txt" <<EOT
Val { A(default=-90,min=-180,max=180) }
Key { }
Body { Core(){ N:Frame(angle=A,spring=$2,damper=$3){ N:Chip(){ N:Chip(){ N:$4(){ } } } } W:Weight(){ } E:Weight(){ } S:Chip(){ S:Weight(){ } } } }
Lua {
function OnFrame()
  if _TICKS()>=150 then A=-60 end
  if _TICKS()>=240 then A=-90 end
end
}
EOT
}
for s in 1 0.5 0.2 0.1 0.05 0.02; do mk arm_${s}_0.5 $s 0.5 Chip; done
for d in 0 0.1 1; do mk arm_0.2_${d} 0.2 $d Chip; done
mk arm_0.1_0.5_w 0.1 0.5 Weight
mk arm_0.2_0.5_w 0.2 0.5 Weight
mk arm_1_0.5_w 1 0.5 Weight
for f in "$M"/arm_*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
