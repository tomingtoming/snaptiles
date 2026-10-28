#!/bin/bash
# joint handedness: a child chip on the E side of a rolled Trim / a yawed Rudder (its centre moves with the sign)
M=$HOME/rc/models
printf 'Val { }\nKey { }\nBody { Core(){ N:Trim(angle=20){ E:Chip(){ } W:Chip(){ } } } }\n' > "$M/sign_trim.txt"
printf 'Val { }\nKey { }\nBody { Core(){ N:Rudder(angle=20){ E:Chip(){ } W:Chip(){ } } } }\n' > "$M/sign_rudder.txt"
printf 'Val { }\nKey { }\nBody { Core(){ E:Trim(angle=20){ N:Chip(){ } S:Chip(){ } } } }\n' > "$M/sign_trimE.txt"
printf 'Val { }\nKey { }\nBody { Core(){ N:Chip(angle=20){ N:Chip(){ } } } }\n' > "$M/sign_chip.txt"
for f in "$M"/sign_*.txt; do echo "$f $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
