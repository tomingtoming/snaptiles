#!/bin/bash
# aero probes: a jet folded 90° on N pushes the model horizontally; a plate on S faces the airflow.
# Val-driven power (literal power= is ignored by the original). Mass ~ core 25 + jet 37 + chips.
M=$HOME/rc/models
mk() { # name, body
  printf 'Val { Engine(default=%s,min=-100000,max=100000) }\nKey { }\nBody { %s }\n' "$2" "$3" > "$M/$1.txt"
}
mk aero_flat   6000 'Core(){ N:Jet(angle=90,power=Engine){ } S:Chip(){ S:Chip(){ } } }'
mk aero_broad  6000 'Core(){ N:Jet(angle=90,power=Engine){ } S:Chip(angle=90){ S:Chip(){ } } }'
mk aero_broad2 20000 'Core(){ N:Jet(angle=90,power=Engine){ } S:Chip(angle=90){ S:Chip(){ } } }'
mk aero_tilt10  6000 'Core(){ N:Jet(angle=90,power=Engine){ } S:Chip(angle=10){ S:Chip(){ } } }'
mk aero_tiltm10 6000 'Core(){ N:Jet(angle=90,power=Engine){ } S:Chip(angle=-10){ S:Chip(){ } } }'
mk aero_tilt20  6000 'Core(){ N:Jet(angle=90,power=Engine){ } S:Chip(angle=20){ S:Chip(){ } } }'
mk aero_tilt45  6000 'Core(){ N:Jet(angle=90,power=Engine){ } S:Chip(angle=45){ S:Chip(){ } } }'
ls "$M"/aero_*.txt | wc -l; cat "$M/aero_tilt10.txt"
