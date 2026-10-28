#!/bin/bash
# The shell leaves along the Arm's own forward direction (the recoil of an upright Arm was vertical).
# armline: Arm flat at the nose pointing N; a loop W->N->E puts a target chip exactly on the line 3.0 m N.
# armcar3: Arm flat at the nose of a wheeled car, nothing ahead, for the recoil along z.
M=$HOME/rc/models
for o in 50000 200000; do
cat > "$M/armline_o$o.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(){ N:Arm(power=Armp,option=$o){ } } W:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ E:Chip(){ } } } } } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=300 then ARMP=1000000 else ARMP=0 end
end
}
EOT
cat > "$M/armcar3_o$o.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(){ N:Chip(){ N:Arm(power=Armp,option=$o){ } } W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=300 then ARMP=1000000 else ARMP=0 end
end
}
EOT
done
for f in "$M"/armline_*.txt "$M"/armcar3_*.txt; do echo "$f $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
