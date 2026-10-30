#!/bin/bash
# Camera probe models: a car circling at constant power and steering from frame 0, and a parked car.
M=$HOME/rc/models
sed "s/if t>=150 then HANDLE=20 else HANDLE=0 end/HANDLE=15/" "$M/turn_a20_p2500.txt" > "$M/cam_circle.txt"
sed "s/Engine(default=2500/Engine(default=0/" "$M/cam_circle.txt" > "$M/cam_parked.txt"
grep -c "HANDLE=15" "$M/cam_circle.txt" "$M/cam_parked.txt"; grep -o "Engine(default=[0-9]*" "$M/cam_parked.txt"
# straight runs (Handle 0) at two engine settings, and a turntable whose yaw is switched on at frame 90
# and off at frame 300 (both rear wheels push the same way; the front axle is on a free Rudder).
sed "s/HANDLE=15/HANDLE=0/" "$M/cam_circle.txt" > "$M/cam_straight.txt"
sed "s/Engine(default=2500/Engine(default=6000/" "$M/cam_straight.txt" > "$M/cam_fast.txt"
cat > "$M/cam_spin.txt" <<'M2'
Val { Engine(default=0,min=-100000,max=100000) Handle(default=0,min=-45,max=45) }
Key { }
Body { Core(){ N:Chip(){ N:Rudder(angle=Handle){ W:Frame(){ W:Wheel(angle=90){ } } E:Frame(){ E:Wheel(angle=90){ } } } } S:Chip(){ W:Frame(){ W:Wheel(angle=90,power=Engine){ } } E:Frame(){ E:Wheel(angle=90,power=Engine){ } } } } }
Lua {
function OnFrame()
  local t=_TICKS()
  if t>=90 and t<300 then ENGINE=1500 else ENGINE=0 end
end
}
M2
grep -c HANDLE=0 "$M/cam_straight.txt"; grep -o "Engine(default=[0-9]*" "$M/cam_fast.txt"
# size dependence of view A: the parked car with a 10-chip N boom (about 6 m longer), and a lone core
# (keeps the Basic Val/Key blocks; a model without Key{} crashed the exe).
sed 's/Body { Core(){ N:Chip(){/Body { Core(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ W:Chip(){ } } } } } } } } } } N:Chip(){/' "$M/cam_parked.txt" > "$M/cam_big.txt"
sed -n '1,/^Body/p' "$M/cam_parked.txt" | sed '$d' > "$M/cam_core.txt"; echo 'Body { Core(){ } }' >> "$M/cam_core.txt"
grep -c "W:Chip(){ W:Chip()" "$M/cam_big.txt"; tail -2 "$M/cam_core.txt"
