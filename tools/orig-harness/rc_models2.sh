#!/bin/bash
# more probe models: jets, and the community 3-wheeler
M=$HOME/rc/models
head_blocks() { sed -n '1,/^Body/p' "$M/basic.txt" | sed '$d'; }
{ head_blocks; echo 'Body { Core(){ N:Jet(angle=0,power=Engine){ } S:Chip(){ } } }'; } > "$M/jet_flat.txt"
{ head_blocks; echo 'Body { Core(){ N:Chip(){ N:Jet(angle=90,power=Engine){ } } S:Chip(){ } } }'; } > "$M/jet_fold90.txt"
iconv -f CP932 -t UTF-8 /mnt/d/snaptiles-models/raw/sprishri/x/ride/3wheel.txt > "$M/3wheel.txt"
ls -l "$M/jet_flat.txt" "$M/jet_fold90.txt" "$M/3wheel.txt"
