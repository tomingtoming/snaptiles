#!/bin/bash
# servo semantics: a heavy body (core + two Weights) on two 1.2 m legs with flat feet. The S hip is a Val:
# leg_lift  A 90 -> 60 at frame 150 (the foot would swing up and sideways)
# leg_push  A 60 -> 90 at frame 150 (the foot would be driven down into the ground)
# leg_swing A 90 -> 120 at frame 150 (the foot swings the other way, also lifting)
M=$HOME/rc/models
mk() { # name default target
cat > "$M/$1.txt" <<EOT
Val { A(default=$2,min=0,max=180) }
Key { }
Body { Core(){ W:Weight(){ } E:Weight(){ } N:Frame(angle=90){ N:Frame(){ N:Chip(angle=-90){ } } } S:Frame(angle=A){ S:Frame(){ S:Chip(angle=-90){ } } } } }
Lua {
function OnFrame()
  if _TICKS()>=150 then A=$3 end
end
}
EOT
}
mk leg_lift 90 60
mk leg_push 60 90
mk leg_swing 90 120
for f in "$M"/leg_*.txt; do echo "$f $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
