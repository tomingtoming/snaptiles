#!/bin/bash
# static compliance of spring joints: an arm at 45° elevation (hinge -45) from a heavy base, a Weight at its tip.
# sag_v_<spring>: hinge angle from a Val (animated); sag_c_<spring>: literal angle (a joint the model never moves).
M=$HOME/rc/models
mk() { # name angle-expr spring
cat > "$M/$1.txt" <<EOT
Val { A(default=-45,min=-180,max=180) }
Key { }
Body { Core(){ N:Frame(angle=$2,spring=$3,damper=0.5){ N:Chip(){ N:Chip(){ N:Weight(){ } } } } W:Weight(){ } E:Weight(){ } S:Chip(){ S:Weight(){ W:Weight(){ } E:Weight(){ } } } } }
Lua {
function OnFrame()
end
}
EOT
}
for s in 1 0.5 0.2 0.1 0.05 0.02; do mk sag_v_$s A $s; mk sag_c_$s -45 $s; done
for f in "$M"/sag_[vc]_*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
