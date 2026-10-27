#!/bin/bash
# lateral grip: Basic-layout car (rear drive, steered front axle on a Rudder), drives from frame 0 at a
# constant Val ENGINE, the model's own Lua turns the Rudder to A degrees from frame 150.
M=$HOME/rc/models
for a in 10 20; do
for p in 1000 2500 5000 10000; do
cat > "$M/turn_a${a}_p${p}.txt" <<EOF
Val { Engine(default=$p,min=-100000,max=100000) Handle(default=0,min=-45,max=45) }
Key { }
Body { Core(){ N:Chip(){ N:Rudder(angle=Handle){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90,power=Engine){ } } E:Frame(){ E:Wheel(angle=90,power=-Engine){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=150 then HANDLE=$a else HANDLE=0 end
end
}
EOF
done
done
ls "$M"/turn_a*.txt | wc -l
