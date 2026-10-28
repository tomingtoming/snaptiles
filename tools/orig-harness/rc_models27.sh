#!/bin/bash
# one Cowl per model (camera sits closer to a small model): option 0..7, folded up on the N side of the core
M=$HOME/rc/models
for o in 0 1 2 3 4 5 6 7; do
printf 'Val { }\nKey { }\nBody { Core(){ N:Cowl(angle=-90,option=%s){ } } }\n' "$o" > "$M/cowl_$o.txt"
done
ls "$M"/cowl_?.txt | wc -l
