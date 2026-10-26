export const CAR = `// four wheel car
Val
{
  HANDLE(default=0, min=-30, max=30, step=3)
  ENGINE(default=0, min=-1500, max=1500, step=40)
  BRAKE(default=0, min=0, max=100, step=100)
}
Key
{
  1:ENGINE(step=60)
  3:ENGINE(step=-60)
  0:HANDLE(step=-3)
  2:HANDLE(step=3)
  4:BRAKE(step=100)
}
Body
{
  Core(color=#f2b705){
    N:Chip(){
      N:Chip(){
        W:Chip(){ W:Rudder(angle=HANDLE){ W:Frame(angle=90){ W:Wheel(power=-ENGINE, brake=BRAKE) } } }
        E:Chip(){ E:Rudder(angle=HANDLE){ E:Frame(angle=90){ E:Wheel(power=ENGINE, brake=BRAKE) } } }
      }
    }
    S:Chip(){
      S:Chip(){
        W:Chip(){ W:Frame(angle=90){ W:Wheel(power=-ENGINE, brake=BRAKE) } }
        E:Chip(){ E:Frame(angle=90){ E:Wheel(power=ENGINE, brake=BRAKE) } }
      }
    }
  }
}
Lua
{
  function OnFrame()
    local v = math.sqrt(_VX(0)^2 + _VY(0)^2 + _VZ(0)^2)
    out(0, "km/h", v * 3.6)
  end
}
`;
