export const PLANE = `// jet plane: ↑↓ pitch, ←→ roll, Z/X throttle
Val
{
  THROTTLE(default=0, min=0, max=60000, step=0)
  ELEV(default=0, min=-25, max=25, step=2)
  AIL(default=0, min=-20, max=20, step=2)
  RUD(default=0, min=-20, max=20, step=2)
}
Key
{
  4:THROTTLE(step=600)
  5:THROTTLE(step=-600)
  1:ELEV(step=-2)
  3:ELEV(step=2)
  0:AIL(step=-2)
  2:AIL(step=2)
  7:RUD(step=-2)
  9:RUD(step=2)
}
Body
{
  Core(color=#f2b705){
    N:Chip(){
      N:Chip(){ N:Chip(color=#2b2b2b){ N:Jet(power=-THROTTLE, angle=-90, color=#ff6a3d){ } } }
    }
    W:Chip(){ W:Chip(){ W:Chip(){ W:Trim(angle=-AIL){ } } } }
    E:Chip(){ E:Chip(){ E:Chip(){ E:Trim(angle=AIL){ } } } }
    S:Chip(){
      S:Chip(){
        S:Chip(){
          W:Chip(){ W:Trim(angle=ELEV){ } }
          E:Chip(){ E:Trim(angle=ELEV){ } }
          S:Chip(angle=-90){ S:Rudder(angle=RUD){ } }
        }
      }
    }
    W:Chip(angle=90){ W:Wheel(){ } }
    E:Chip(angle=90){ E:Wheel(){ } }
    S:Chip(angle=90){ S:Wheel(){ } }
  }
}
Lua
{
  function OnFrame()
    local v = math.sqrt(_VX(0)^2 + _VY(0)^2 + _VZ(0)^2)
    out(0, "km/h", v * 3.6)
    out(1, "alt", _Y(0))
  end
}
`;
