#!/bin/bash
# straight-line wheel-spin probe: Basic-layout car, powered S axle, no steering, power 2500/5000/10000/20000
M=$HOME/rc/models
for p in 2500 5000 10000 20000; do
cat > "$M/spin_p${p}.txt" <<EOT
Val { Engine(default=$p,min=-100000,max=100000) Handle(default=0,min=-45,max=45) }
Key { }
Body { Core(){ N:Chip(){ N:Rudder(angle=Handle){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90,power=Engine){ } } E:Frame(){ E:Wheel(angle=90,power=-Engine){ } } } } }
EOT
done
ls "$M"/spin_p*.txt | wc -l
