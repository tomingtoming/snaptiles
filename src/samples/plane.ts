export const PLANE = `// jet plane with a Lua autopilot: Z/X throttle (it lifts off by itself), ↓↑ climb/descend, ←→ bank, A/D rudder.
// Release the arrows to hold height and level the wings.
Val
{
  THROTTLE(default=0, min=0, max=60000, step=0)
  CLIMB(default=0, min=-10, max=10, step=1)
  BANK(default=0, min=-45, max=45, step=3)
  ELEV(default=0, min=-30, max=30, step=0)
  AIL(default=0, min=-20, max=20, step=0)
  RUD(default=0, min=-20, max=20, step=2)
}
Key
{
  4:THROTTLE(step=600)
  5:THROTTLE(step=-600)
  0:CLIMB(step=-1)
  1:CLIMB(step=1)
  2:BANK(step=-3)
  3:BANK(step=3)
  7:RUD(step=-2)
  9:RUD(step=2)
}
Body
{
  Core(color=#f2b705){
    N:Chip(){
      N:Trim(angle=90){ E:Chip(){ E:Wheel(){ } } }
      N:Chip(){ N:Chip(color=#2b2b2b){ N:Jet(power=THROTTLE, angle=90, color=#ff6a3d){ } N:Jet(power=-THROTTLE, angle=-90, color=#ff6a3d){ } } }
    }
    S:Chip(){
      W:Chip(){ W:Chip(){ W:Chip(){ W:Trim(angle=-AIL){ } } } W:Chip(angle=90){ W:Wheel(){ } } }
      E:Chip(){ E:Chip(){ E:Chip(){ E:Trim(angle=-AIL){ } } } E:Chip(angle=90){ E:Wheel(){ } } }
      S:Chip(){
        S:Chip(){
          W:Trim(angle=ELEV){ W:Trim(angle=0){ } }
          E:Trim(angle=-ELEV){ E:Trim(angle=0){ } }
          S:Trim(angle=90){ S:Chip(angle=RUD){ } }
        }
      }
    }
  }
}
Lua
{
  -- Autopilot: ↓↑ set a wanted climb rate (CLIMB, m/s) and ←→ a bank angle (BANK, degrees);
  -- Lua moves the elevator and ailerons. _EX(0) is + when the nose is down, _EZ(0) + when the E wing is down.
  -- Plates lift little near zero angle of attack, so without this loop the plane neither holds pitch nor roll.
  local KP, KD, KR, KRD = 4, 1, 1, 0.3
  local lastP, lastR, lastY = 0, 0, nil
  function OnFrame()
    local y = _Y(0)
    local vy = lastY and (y - lastY) * 30 or 0
    lastY = y
    -- outer loop: about 8 degrees nose-up holds level flight; climb-rate error moves that target
    local target = math.max(-10, math.min(20, 8 + 2 * (CLIMB - vy)))
    local pitch = -math.deg(_EX(0))
    local roll = math.deg(_EZ(0))
    local dp, dr = pitch - lastP, roll - lastR
    lastP, lastR = pitch, roll
    ELEV = KP * (target - pitch) - KD * dp * 30
    AIL = KR * (BANK - roll) - KRD * dr * 30
    local v = math.sqrt(_VX(0)^2 + _VY(0)^2 + _VZ(0)^2)
    out(0, "km/h", v * 3.6)
    out(1, "alt", _Y(0))
  end
}
`;
