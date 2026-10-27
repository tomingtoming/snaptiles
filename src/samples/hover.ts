export const HOVER = `// hover platform: four jets with a Lua altitude/attitude hold. ↑↓ forward/back, ←→ sideways, A/D turn
Val
{
  FWD(default=0, min=-1, max=1, step=0.1)
  SIDE(default=0, min=-1, max=1, step=0.1)
  TURN(default=0, min=-1, max=1, step=0.1)
  J_FL(default=0, min=0, max=60000)
  J_FR(default=0, min=0, max=60000)
  J_RL(default=0, min=0, max=60000)
  J_RR(default=0, min=0, max=60000)
  YAWJ(default=0, min=-20000, max=20000)
  K_P(default=1, min=-5, max=5)
  K_R(default=-1, min=-5, max=5)
}
Key
{
  1:FWD(step=0.2)
  3:FWD(step=-0.2)
  0:SIDE(step=-0.2)
  2:SIDE(step=0.2)
  7:TURN(step=-0.2)
  9:TURN(step=0.2)
}
Body
{
  Core(color=#f2b705){
    N:Chip(color=#d8d8d8){
      W:Chip(color=#d8d8d8){ W:Jet(power=J_FL, color=#ff6a3d){ } }
      E:Chip(color=#d8d8d8){ E:Jet(power=J_FR, color=#ff6a3d){ } }
      N:Chip(color=#7fb7ff){ W:Chip(angle=-90, color=#7fb7ff){ W:Jet(power=YAWJ, color=#ff6a3d){ } } }
    }
    S:Chip(color=#d8d8d8){
      W:Chip(color=#d8d8d8){ W:Jet(power=J_RL, color=#ff6a3d){ } }
      E:Chip(color=#d8d8d8){ E:Jet(power=J_RR, color=#ff6a3d){ } }
      S:Chip(color=#7fb7ff){ E:Chip(angle=-90, color=#7fb7ff){ E:Jet(power=YAWJ, color=#ff6a3d){ } } }
    }
  }
}
Lua
{
  function clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi end return v end
  TARGET = 3
  lastPitch, lastRoll = 0, 0
  function OnFrame()
    local h = _H(0)
    if h < 0 then h = TARGET end
    local vy = _VY(0)
    local pitch = math.deg(_AX(0))   -- positive = nose down
    local roll = math.deg(_AZ(0))
    local dPitch, dRoll = pitch - lastPitch, roll - lastRoll
    lastPitch, lastRoll = pitch, roll
    -- hover: lift against gravity plus height/vertical-speed correction
    local base = 7300 + (TARGET - h) * 6000 - vy * 4000
    -- lean toward the stick, then level (PD on the attitude angles)
    local p = K_P * ((pitch - FWD * 8) + dPitch * 10)
    local r = K_R * ((roll + SIDE * 8) + dRoll * 10)
    J_FL = clamp(base + p * 300 - r * 300, 0, 60000)
    J_FR = clamp(base + p * 300 + r * 300, 0, 60000)
    J_RL = clamp(base - p * 300 - r * 300, 0, 60000)
    J_RR = clamp(base - p * 300 + r * 300, 0, 60000)
    YAWJ = TURN * 15000
    out(0, "alt", h)
  end
}
`;
