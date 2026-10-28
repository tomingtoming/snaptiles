#!/bin/bash
# fuel probes: wheel drive at 2500 (rear axle), a stand-up jet at 10000 on wheels, and the charging Arm car
M=$HOME/rc/models
cat > "$M/fuel_wheel.txt" <<EOT
Val { Engine(default=2500,min=-100000,max=100000) }
Key { }
Body { Core(){ N:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90,power=Engine){ } } E:Frame(){ E:Wheel(angle=90,power=-Engine){ } } } } }
EOT
cat > "$M/fuel_jet.txt" <<EOT
Val { Engine(default=10000,min=-100000,max=100000) }
Key { }
Body { Core(){ N:Chip(){ N:Jet(angle=-90,power=Engine){ } W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } S:Chip(){ S:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } S:Chip(){ } } } }
EOT
cat > "$M/fuel_arm.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(){ N:Chip(){ N:Arm(power=Armp,option=50000){ } } W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=300 then ARMP=1000000 else ARMP=0 end
end
}
EOT
for f in "$M"/fuel_*.txt; do echo "$f $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
