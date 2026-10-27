#!/bin/bash
# heavier turn car (4 Weights on the core, +403 kg): does the per-wheel force cap scale with load?
M=$HOME/rc/models
for p in 1000 2500 5000; do
cat > "$M/heavy4_a10_p${p}.txt" <<EOT
Val { Engine(default=$p,min=-100000,max=100000) Handle(default=0,min=-45,max=45) }
Key { }
Body { Core(){ W:Weight(){ W:Weight(){ } } E:Weight(){ E:Weight(){ } } N:Chip(){ N:Rudder(angle=Handle){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90,power=Engine){ } } E:Frame(){ E:Wheel(angle=90,power=-Engine){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=150 then HANDLE=10 else HANDLE=0 end
end
}
EOT
done
ls "$M"/heavy4_*.txt | wc -l
