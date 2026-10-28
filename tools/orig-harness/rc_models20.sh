#!/bin/bash
# Arm probes. Column models: the Arm sits at the end of a two-chip column folded up (-90) or down (+90) on
# the N side, a target column of three chips stands 3.6 m away on the S side (own chips are hit in the
# original). The Arm's power is raised to the option value during frames 200..229 by the model's Lua.
M=$HOME/rc/models
mk() { # name fold option targettype
cat > "$M/$1.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(angle=$2){ N:Chip(){ N:Arm(power=Armp,option=$3){ } } } S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(angle=$2){ S:$4(){ S:$4(){ } } } } } } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=200 and t<230 then ARMP=$3 else ARMP=0 end
end
}
EOT
}
mk arm_up_o10000_chip -90 10000 Chip
mk arm_dn_o10000_chip 90 10000 Chip
mk arm_up_o100000_chip -90 100000 Chip
mk arm_dn_o100000_chip 90 100000 Chip
mk arm_up_o10000_weight -90 10000 Weight
mk arm_dn_o10000_weight 90 10000 Weight
# recoil car: Basic layout without drive, Arm on a column folded up at the nose, nothing in the line of fire
for o in 10000 100000; do
cat > "$M/armcar_o$o.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(){ N:Chip(angle=-90){ N:Arm(power=Armp,option=$o){ } } W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=200 and t<230 then ARMP=$o else ARMP=0 end
end
}
EOT
done
ls "$M"/arm*.txt | wc -l
