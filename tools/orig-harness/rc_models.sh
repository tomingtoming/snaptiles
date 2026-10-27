#!/bin/bash
# extra probe models for the original (Val/Key blocks copied from Basic so the exe does not crash)
M=$HOME/rc/models
head_blocks() { sed -n '1,/^Body/p' "$M/basic.txt" | sed '$d'; }
{ head_blocks; echo 'Body { Core(){ N:Chip(){ N:Wheel(angle=-90,power=Engine){ } } S:Chip(){ } } }'; } > "$M/wheel_up.txt"
{ head_blocks; echo 'Body { Core(){ N:Chip(angle=30){ } S:Chip(angle=30){ } E:Chip(angle=30){ } W:Chip(angle=30){ } } }'; } > "$M/fold30.txt"
{ head_blocks; echo 'Body { Core(){ N:Chip(){ N:Trim(angle=30){ } } S:Chip(){ S:Rudder(angle=30){ } } } }'; } > "$M/trimrudder30.txt"
ls -l "$M"/wheel_up.txt "$M"/fold30.txt "$M"/trimrudder30.txt
tail -1 "$M/wheel_up.txt"
