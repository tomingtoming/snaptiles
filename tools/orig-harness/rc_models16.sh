#!/bin/bash
# brake coefficient and sliding friction of Chip/Weight, all driven by the model's own Lua
M=$HOME/rc/models
# jet car (stand-up jet, 4 wheels with brake=B): jet on until frame 120, brake B from frame 150
for b in 10 50; do
cat > "$M/brake3_$b.txt" <<EOF
Val {
	Engine(default=10000,min=-100000,max=100000)
	B(default=0,min=0,max=1000)
}
Key { }
Body { Core(){ N:Chip(){ N:Jet(angle=-90,power=Engine){ } W:Frame(){ W:Wheel(angle=90,brake=B){ } } E:Frame(){ E:Wheel(angle=90,brake=B){ } } } S:Chip(){ S:Chip(){ W:Frame(){ W:Wheel(angle=90,brake=B){ } } E:Frame(){ E:Wheel(angle=90,brake=B){ } } S:Chip(){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=120 then Engine=0 end
  if t>=150 then B=$b else B=0 end
end
}
EOF
done
# friction sleds: stand-up jet on a flat nose chip, plates of Chip or Weight on the ground (edge-on)
printf 'Val { Engine(default=10000,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Chip(){ N:Jet(angle=-90,power=Engine){ } } S:Chip(){ S:Chip(){ } } W:Chip(){ } E:Chip(){ } } }\n' > "$M/fric_chip.txt"
printf 'Val { Engine(default=10000,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Chip(){ N:Jet(angle=-90,power=Engine){ } } S:Weight(){ S:Weight(){ } } W:Weight(){ } E:Weight(){ } } }\n' > "$M/fric_weight.txt"
printf 'Val { Engine(default=10000,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Chip(){ N:Jet(angle=-90,power=Engine){ } } S:Frame(){ S:Frame(){ } } W:Frame(){ } E:Frame(){ } } }\n' > "$M/fric_frame.txt"
ls "$M"/brake_*.txt "$M"/fric_*.txt | wc -l
