#!/bin/bash
# Arm semantics: which attribute fires (power vs option), cadence, direction. Firing window frames 300..600 so
# the 15 s screenshot (frame ~450) catches the tracers.
M=$HOME/rc/models
car() { # name power option
cat > "$M/$1.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(){ N:Chip(angle=-90){ N:Arm(power=Armp,option=$3){ } } W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=300 then ARMP=$2 else ARMP=0 end
end
}
EOT
}
car armcar2_p10000_o0 10000 0
car armcar2_p10000_o10000 10000 10000
car armcar2_p100000_o0 100000 0
car armcar2_p100000_o100000 100000 100000
car armcar2_p10000_o100000 10000 100000
cat > "$M/armcol2_p100000.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(angle=-90){ N:Chip(){ N:Arm(power=Armp,option=0){ } } } S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(angle=-90){ S:Chip(){ S:Chip(){ } } } } } } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=300 then ARMP=100000 else ARMP=0 end
end
}
EOT
ls "$M"/armcar2_*.txt "$M"/armcol2_*.txt | wc -l
