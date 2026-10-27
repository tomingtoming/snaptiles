#!/bin/bash
# servo response and joint sag probes (Vals driven by the model's own Lua)
M=$HOME/rc/models
# rudder step: A goes 0 -> 60 at frame 31, 60 -> -60 at frame 121; chip 1 is the Rudder, chip 2 its child
cat > "$M/servo_rudder.txt" <<'EOF'
Val { A(default=0,min=-180,max=180) }
Key { }
Body { Core(){ N:Rudder(angle=A){ N:Chip(){ } } S:Chip(){ } W:Chip(){ } E:Chip(){ } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=30 and t<120 then A=60 elseif t>=120 then A=-60 else A=0 end
end
}
EOF
# chip (hinge) step with a load: Frame arm with two Weights at the end, A 0 -> 45 at frame 31 (lifting the load), -> 0 at 121
cat > "$M/servo_hinge_load.txt" <<'EOF'
Val { A(default=0,min=-180,max=180) }
Key { }
Body { Core(){ N:Frame(angle=A){ N:Weight(){ N:Weight(){ } } } S:Chip(){ S:Chip(){ } } W:Chip(){ } E:Chip(){ } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=30 and t<120 then A=-45 elseif t>=120 then A=0 else A=0 end
end
}
EOF
# static sag: a long arm of frames holding two weights, angle constant 0 (hinge sag under gravity)
cat > "$M/sag_arm.txt" <<'EOF'
Val { A(default=0,min=-180,max=180) }
Key { }
Body { Core(){ N:Frame(angle=A){ N:Frame(){ N:Weight(option=4){ } } } S:Chip(){ S:Weight(option=4){ } } W:Chip(){ } E:Chip(){ } } }
EOF
# spring joint: same arm with spring=0.5 / 0.1
sed 's/N:Frame(angle=A)/N:Frame(angle=A, spring=0.5, damper=0.5)/' "$M/sag_arm.txt" > "$M/sag_arm_spring05.txt"
sed 's/N:Frame(angle=A)/N:Frame(angle=A, spring=0.1, damper=0.5)/' "$M/sag_arm.txt" > "$M/sag_arm_spring01.txt"
ls -l "$M"/servo_*.txt "$M"/sag_*.txt
