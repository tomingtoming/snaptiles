export const TANK = `// tank: ↑↓ drive, ←→ steer, A/D turn the turret, Z fire (the gun recharges between shots)
Val
{
  HANDLE(default=0, min=-30, max=30, step=3)
  ENGINE(default=0, min=-1500, max=1500, step=100)
  TURRET(default=0, min=-150, max=150)
  TURN(default=0, min=-1, max=1, step=1)
  FIRE(default=0, min=0, max=100000, step=100000)
}
Key
{
  0:ENGINE(step=100)
  1:ENGINE(step=-100)
  2:HANDLE(step=-3)
  3:HANDLE(step=3)
  7:TURN(step=-1)
  9:TURN(step=1)
  4:FIRE(step=100000)
}
Body
{
  Core(color=#6b7a3a){
    N:Chip(color=#6b7a3a){
      N:Chip(color=#6b7a3a){
        W:Chip(color=#6b7a3a){ W:Rudder(angle=HANDLE, color=#6b7a3a){ W:Frame(angle=90){ W:Wheel(power=-ENGINE) } } }
        E:Chip(color=#6b7a3a){ E:Rudder(angle=HANDLE, color=#6b7a3a){ E:Frame(angle=90){ E:Wheel(power=ENGINE) } } }
      }
    }
    S:Chip(color=#6b7a3a){
      S:Chip(color=#6b7a3a){
        W:Chip(color=#6b7a3a){ W:Frame(angle=90){ W:Wheel(power=-ENGINE) } }
        E:Chip(color=#6b7a3a){ E:Frame(angle=90){ E:Wheel(power=ENGINE) } }
      }
    }
    W:Weight(color=#55632e){ } E:Weight(color=#55632e){ }
    N:Rudder(angle=TURRET, color=#55632e){
      N:Chip(angle=-90, color=#55632e){ N:Arm(angle=90, power=FIRE, option=30000, name=GUN, color=#2b2b2b){ } }
    }
  }
}
Lua
{
  function OnFrame()
    TURRET = TURRET + TURN * 3
    if TURRET > 150 then TURRET = 150 elseif TURRET < -150 then TURRET = -150 end
    out(0, "charge", math.floor(_E(GUN) / 300), "%")
  end
}
`;
