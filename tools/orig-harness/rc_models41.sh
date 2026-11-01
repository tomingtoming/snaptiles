#!/bin/bash
# weak spring joints: a short arm (Frame + Chip, ~184 N·m at 45°) on the sag_v base, spring 0.03/0.02/0.012/0.008
M=$HOME/rc/models
for s in 0.03 0.02 0.012 0.008; do
cat > "$M/sagw_$s.txt" <<EOT
Val { A(default=-45,min=-180,max=180) }
Key { }
Body { Core(){ N:Frame(angle=A,spring=$s,damper=0.5){ N:Chip(){ N:Chip(){ } } } W:Weight(){ } E:Weight(){ } S:Chip(){ S:Weight(){ W:Weight(){ } E:Weight(){ } } } } }
Lua {
function OnFrame()
end
}
EOT
done
