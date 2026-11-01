#!/bin/bash
# attitude APIs of an upside-down chip (folded 180 over the core) while the model rests pitched or rolled
M=$HOME/rc/models
mk() { printf 'Val { A(default=0) }\nKey { }\nBody { Core(){ %s } }\n' "$2" > "$M/$1.txt"; }
mk flip_flat 'N:Chip(angle=180){ }'
mk flip_pitchS 'N:Chip(angle=180){ } S:Chip(angle=40){ }'
mk flip_pitchN 'S:Chip(angle=180){ } N:Chip(angle=40){ }'
mk flip_rollE 'N:Chip(angle=180){ } E:Chip(angle=40){ }'
mk flip_rollW 'N:Chip(angle=180){ } W:Chip(angle=40){ }'
mk trim_flat 'N:Chip(){ N:Trim(angle=180){ } }'
mk trim_rollE 'N:Chip(){ N:Trim(angle=180){ } } E:Chip(angle=40){ }'
mk trim_pitchS 'N:Chip(){ N:Trim(angle=180){ } } S:Chip(angle=40){ }'
