#!/bin/bash
# Arm direction + damage: a vertical Arm (two-chip column folded up on the N side of the core, normal along z)
# with vertical target columns both 3.6 m S and 2.4 m N of it, third chip centred at the Arm's height (1.5).
# Trigger as the community models do: power jumps to 1000000 from frame 300, option = shot energy.
M=$HOME/rc/models
for o in 50000 200000; do
cat > "$M/armx_o$o.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(angle=-90){ N:Chip(){ N:Arm(power=Armp,option=$o){ } } } S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(){ S:Chip(angle=-90){ S:Chip(){ S:Chip(){ } } } } } } } } W:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ E:Chip(){ S:Chip(angle=-90){ S:Chip(){ S:Chip(){ } } } } } } } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=300 then ARMP=1000000 else ARMP=0 end
end
}
EOT
done
ls "$M"/armx_*.txt | wc -l
