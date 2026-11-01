#!/bin/bash
# rotor probes: a horizontal wheel on a weighted base, two Trim blades on it (harness_servo2.rcs logs chips 0..9).
# rot_<kind>_p<power>_a<pitch>: kind rlw/whl, blades pitched +a/-a on the W/E sides; rlw_bare has no children.
M=$HOME/rc/models
mk() { # name kind power children
cat > "$M/$1.txt" <<EOT
Val { P(default=0,min=-100000,max=100000) }
Key { }
Body { Core(){ N:$2(angle=0,power=P){ $4 } W:Weight(){ } E:Weight(){ } S:Weight(){ S:Weight(){ } } } }
Lua {
function OnFrame()
  if _TICKS()>=60 then P=$3 end
end
}
EOT
}
for p in 5000 20000 60000; do mk rot_rlw_p${p}_a0 RLW $p 'W:Trim(angle=0){ } E:Trim(angle=0){ }'; done
for p in 20000 60000; do mk rot_rlw_p${p}_a10 RLW $p 'W:Trim(angle=10){ } E:Trim(angle=-10){ }'; done
mk rot_rlw_p60000_am10 RLW 60000 'W:Trim(angle=-10){ } E:Trim(angle=10){ }'
mk rot_rlwbare_p60000 RLW 60000 ''
mk rot_whl_p20000_a0 Wheel 20000 'W:Trim(angle=0){ } E:Trim(angle=0){ }'
mk rot_rlw_p20000_w RLW 20000 'W:Weight(){ } E:Weight(){ }'
for f in "$M"/rot_*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
