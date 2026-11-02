#!/bin/bash
# which side of a spring joint sets its give: a symmetric bridge built as one chain from foot A (the Core) —
# leg A up 30° → spring joint A → body (two Chips with Weights) → spring joint B → leg B down 30° → foot B (a Chip).
# Both joints carry the same torque; joint A's subtree is the body and leg B (heavy), joint B's only leg B and foot B
# (light). swap_<spring>_w<option>. Chips: 0 foot A, 1 leg A, 2 body 1, 3/4 its Weights, 5 body 2, 6/7 its Weights,
# 8 leg B, 9 foot B. harness_land.rcs logs chips 0..19.
M=${M:-$HOME/rc/models}
mk() { # name spring option
  local w="Weight(option=$3){ }"
  printf 'Val { A(default=0,min=-180,max=180) }\nKey { }\nBody { Core(){ N:Frame(angle=-30){ N:Chip(angle=30,spring=%s,damper=0.5){ W:%s E:%s N:Chip(){ W:%s E:%s N:Frame(angle=30,spring=%s,damper=0.5){ N:Chip(angle=-30){ } } } } } } }\nLua {\nfunction OnFrame()\nend\n}\n' \
    "$2" "$w" "$w" "$w" "$w" "$2" > "$M/$1.txt"
}
for s in 0.1 0.2; do for o in 1 2 4; do mk swap_${s}_w$o $s $o; done; done
mk swap_1_w2 1 2
for f in "$M"/swap_*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
