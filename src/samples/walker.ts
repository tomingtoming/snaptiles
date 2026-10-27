export const WALKER = `// four-legged walker: ↑↓ walk, ←→ turn (Lua drives the leg joints)
Val
{
  GO(default=0, min=-1, max=1, step=0.1)
  TURN(default=0, min=-1, max=1, step=0.1)
  FL_H(default=0, min=-45, max=45)  FL_K(default=35, min=0, max=100)
  FR_H(default=0, min=-45, max=45)  FR_K(default=35, min=0, max=100)
  RL_H(default=0, min=-45, max=45)  RL_K(default=35, min=0, max=100)
  RR_H(default=0, min=-45, max=45)  RR_K(default=35, min=0, max=100)
}
Key
{
  0:GO(step=0.2)
  1:GO(step=-0.2)
  2:TURN(step=-0.2)
  3:TURN(step=0.2)
}
Body
{
  Core(color=#f2b705){
    N:Chip(color=#d8d8d8){
      W:Rudder(angle=FL_H, color=#7fb7ff){ W:Frame(angle=FL_K, color=#7fb7ff){ W:Frame(angle=90, color=#303030){ } } }
      E:Rudder(angle=-FR_H, color=#7fb7ff){ E:Frame(angle=FR_K, color=#7fb7ff){ E:Frame(angle=90, color=#303030){ } } }
    }
    S:Chip(color=#d8d8d8){
      W:Rudder(angle=RL_H, color=#b7ff7f){ W:Frame(angle=RL_K, color=#b7ff7f){ W:Frame(angle=90, color=#303030){ } } }
      E:Rudder(angle=-RR_H, color=#b7ff7f){ E:Frame(angle=RR_K, color=#b7ff7f){ E:Frame(angle=90, color=#303030){ } } }
    }
  }
}
Lua
{
  -- crawl gait: the hip (Rudder) swings the leg fore/aft, the knee (Frame) lifts it
  phase = 0
  function leg(t)
    -- t in [0,1): first half swings forward lifted, second half pushes back planted
    if t < 0.5 then
      local u = t / 0.5
      return -30 + 60 * u, 35 + 45 * math.sin(u * math.pi)
    end
    local u = (t - 0.5) / 0.5
    return 30 - 60 * u, 35
  end
  function OnFrame()
    local speed = GO + math.abs(TURN) * 0.6
    if math.abs(speed) < 0.05 then return end
    phase = (phase + 0.015 * speed) % 1
    local l = 1 + TURN * 0.8   -- turning right (TURN>0): the right legs take shorter strides
    local r = 1 - TURN * 0.8
    local h, k
    h, k = leg((phase + 0.00) % 1) FL_H, FL_K = h * l, k
    h, k = leg((phase + 0.50) % 1) FR_H, FR_K = h * r, k
    h, k = leg((phase + 0.25) % 1) RR_H, RR_K = h * r, k
    h, k = leg((phase + 0.75) % 1) RL_H, RL_K = h * l, k
    out(0, "step", math.floor(phase * 4))
  end
}
`;
