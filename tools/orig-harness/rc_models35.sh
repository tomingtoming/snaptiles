#!/bin/bash
# attitude API signs: a core resting pitched (a chip folded down on its N or S edge) or rolled (E/W edge)
M=$HOME/rc/models
for d in N S E W; do
printf 'Val { A(default=0) }\nKey { }\nBody { Core(){ %s:Chip(angle=40){ } } }\n' $d > "$M/tilt_$d.txt"
done
