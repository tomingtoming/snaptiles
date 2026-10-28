#!/bin/bash
# Arm damage vs chip mass: the armline target chip replaced by a Weight (100.8 kg) and by a Frame (12.6 kg)
M=$HOME/rc/models
for tt in Weight Frame; do
cat > "$M/armline_o50000_$tt.txt" <<EOT
Val { Armp(default=0,min=0,max=1000000) }
Key { }
Body { Core(){ N:Chip(){ N:Arm(power=Armp,option=50000){ } } W:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ N:Chip(){ E:$tt(){ } } } } } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=300 then ARMP=1000000 else ARMP=0 end
end
}
EOT
done
for f in "$M"/armline_o50000_*.txt; do echo "$f $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
