export const RAFT = `// 双胴艇：↑↓で前後進、←→で旋回。左右のJetの推力差で舵を取ります。
Val {
  THRUST(default=0,min=-1200,max=3600)
  TURN(default=0,min=-2200,max=2200)
  PORT(default=0,min=-5800,max=5800,disp=0)
  STARBOARD(default=0,min=-5800,max=5800,disp=0)
}
Key { 0:THRUST(step=400) 1:THRUST(step=-400) 2:TURN(step=-300) 3:TURN(step=300) }
Body { Core(color=#f3ba49){
  N:Chip(color=#3b969a){ N:Chip(color=#f0dfb0){} }
  W:Chip(color=#f0dfb0){ W:Chip(color=#398a9c){ N:Chip(){} S:Jet(angle=-90,power=PORT){} } }
  E:Chip(color=#f0dfb0){ E:Chip(color=#398a9c){ N:Chip(){} S:Jet(angle=-90,power=STARBOARD){} } }
  S:Chip(color=#f0dfb0){}
} }
Lua {
local function center(value, step)
  if value > 0 then return math.max(0, value - step) end
  return math.min(0, value + step)
end
function OnFrame()
  if _KEY(0)==0 and _KEY(1)==0 then THRUST = center(THRUST, 400) end
  if _KEY(2)==0 and _KEY(3)==0 then TURN = center(TURN, 300) end
  PORT = THRUST + TURN
  STARBOARD = THRUST - TURN
end
}
`;
