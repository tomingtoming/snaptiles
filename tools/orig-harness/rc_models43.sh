#!/bin/bash
# spring joints under load, scaled: the rc_models42.sh body on two legs folded 30° down through spring joints
# (damper 0.5), with the four body Weights at option 1/2/4 (100.8/201.6/403.2 kg each) and legs of one or two Frames.
# law_<spring>_L<segments>_w<option>; harness_land.rcs logs chips 0..19. Chip order: 0 Core, 1 N Chip, 2 hinged leg
# Frame, (3 second leg Frame), then the foot.
M=${M:-$HOME/rc/models}
mk() { # name spring segments option
  local leg foot='N:Frame(angle=-30){ }' sfoot='S:Frame(angle=-30){ }' w="Weight(option=$4){ }"
  if [ "$3" = 2 ]; then leg="N:Frame(angle=30,spring=$2,damper=0.5){ N:Frame(){ $foot } }"; sleg="S:Frame(angle=30,spring=$2,damper=0.5){ S:Frame(){ $sfoot } }"
  else leg="N:Frame(angle=30,spring=$2,damper=0.5){ $foot }"; sleg="S:Frame(angle=30,spring=$2,damper=0.5){ $sfoot }"; fi
  printf 'Val { A(default=0,min=-180,max=180) }\nKey { }\nBody { Core(){ N:Chip(){ %s W:%s E:%s } S:Chip(){ %s W:%s E:%s } } }\nLua {\nfunction OnFrame()\nend\n}\n' \
    "$leg" "$w" "$w" "$sleg" "$w" "$w" > "$M/$1.txt"
}
for s in 0.1 0.2; do for o in 1 2 4; do mk law_${s}_L1_w$o $s 1 $o; done; done
mk law_0.1_L2_w1 0.1 2 1
mk law_0.1_L2_w2 0.1 2 2
mk law_0.2_L2_w1 0.2 2 1
mk law_1_L1_w2 1 1 2
mk law_1_L2_w1 1 2 1
for f in "$M"/law_*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
