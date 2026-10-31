#!/bin/bash
# spring/damper servo response: the leg_lift body (A 90 -> 60 at frame 150) with spring/damper on the moving hip.
# Does a joint with spring<1 still reach the commanded angle within a frame?
M=$HOME/rc/models
mk() { # name spring damper
cat > "$M/$1.txt" <<EOT
Val { A(default=90,min=0,max=180) }
Key { }
Body { Core(){ W:Weight(){ } E:Weight(){ } N:Frame(angle=90){ N:Frame(){ N:Chip(angle=-90){ } } } S:Frame(angle=A,spring=$2,damper=$3){ S:Frame(){ S:Chip(angle=-90){ } } } } }
Lua {
function OnFrame()
  if _TICKS()>=150 then A=60 end
end
}
EOT
}
mk sd_s1_d05 1 0.5
mk sd_s02_d05 0.2 0.5
mk sd_s05_d05 0.5 0.5
mk sd_s02_d01 0.2 0.1
mk sd_s02_d1 0.2 1
mk sd_s005_d05 0.05 0.5
for f in "$M"/sd_*.txt; do echo "$f $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
