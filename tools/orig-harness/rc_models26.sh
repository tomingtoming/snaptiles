#!/bin/bash
# Cowl options side by side: a row of chips W->E, each carrying a Cowl with option 0..7 folded up 90 degrees
M=$HOME/rc/models
B='Core(){'
for o in 0 1 2 3 4 5 6 7; do B="$B"; done
cat > "$M/cowls.txt" <<EOT
Val { }
Key { }
Body { Core(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ N:Cowl(angle=-90,option=0){ } } N:Cowl(angle=-90,option=1){ } } N:Cowl(angle=-90,option=2){ } } N:Cowl(angle=-90,option=3){ } } E:Chip(){ E:Chip(){ E:Chip(){ E:Chip(){ N:Cowl(angle=-90,option=7){ } } N:Cowl(angle=-90,option=6){ } } N:Cowl(angle=-90,option=5){ } } N:Cowl(angle=-90,option=4){ } } } }
EOT
cat > "$M/cowls_flat.txt" <<EOT
Val { }
Key { }
Body { Core(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ N:Cowl(option=0){ } } N:Cowl(option=1){ } } N:Cowl(option=2){ } } N:Cowl(option=3){ } } E:Chip(){ E:Chip(){ E:Chip(){ E:Chip(){ N:Cowl(option=7){ } } N:Cowl(option=6){ } } N:Cowl(option=5){ } } N:Cowl(option=4){ } } } }
EOT
for f in "$M"/cowls*.txt; do echo "$f $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
