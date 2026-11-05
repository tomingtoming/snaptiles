export const RAFT = `// 双胴艇：↑↓で前後進、←→で旋回。左右のJetの推力差で舵を取ります。
Val {
  THRUST(default=0,min=-1200,max=3600,step=400)
  TURN(default=0,min=-2200,max=2200,step=300)
}
Key { 0:THRUST(step=400) 1:THRUST(step=-400) 2:TURN(step=-300) 3:TURN(step=300) }
Body { Core(color=#f3ba49){
  N:Chip(color=#3b969a){ N:Chip(color=#f0dfb0){} }
  W:Chip(color=#f0dfb0){ W:Chip(color=#398a9c){ N:Chip(){} S:Jet(angle=-90,power=THRUST+TURN){} } }
  E:Chip(color=#f0dfb0){ E:Chip(color=#398a9c){ N:Chip(){} S:Jet(angle=-90,power=THRUST-TURN){} } }
  S:Chip(color=#f0dfb0){}
} }
`;
