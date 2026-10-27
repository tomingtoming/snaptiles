import csv, math, sys

# Steady-turn analysis of harness_turn2 logs (original) and orig-compare --turn logs (SnapTiles).
# Columns used by name: frame,x,z,vx,vz,wy,ey. Per window: speed from world xz positions, heading from the
# world velocity direction, yaw rate from its derivative, curvature radius, lateral acceleration, sideslip.

def load(path):
    rows = list(csv.DictReader(open(path, encoding='utf-8')))
    out = []
    for r in rows:
        try:
            out.append({k: float(r[k]) for k in ('frame', 'x', 'z', 'vx', 'vz', 'wy', 'ey')})
        except (ValueError, KeyError):
            pass
    return out

def analyse(rows, win=20, start=150):
    by = {int(r['frame']): r for r in rows}
    res = []
    for f0 in range(start, max(by) - win, win):
        a, b = by.get(f0), by.get(f0 + win)
        if not a or not b:
            continue
        # headings from short differences around a and b
        def heading(f):
            p, q = by.get(f - 2), by.get(f + 2)
            if not p or not q:
                return None, 0.0
            dx, dz = q['x'] - p['x'], q['z'] - p['z']
            return math.atan2(dx, dz), math.hypot(dx, dz) * 30 / 4
        ha, va = heading(f0)
        hb, vb = heading(f0 + win)
        if ha is None or hb is None:
            continue
        d = hb - ha
        while d > math.pi: d -= 2 * math.pi
        while d < -math.pi: d += 2 * math.pi
        rate = d / (win / 30)
        v = (va + vb) / 2
        R = v / abs(rate) if abs(rate) > 1e-6 else float('inf')
        slip = math.degrees(math.atan2(a['vx'], a['vz'])) if abs(a['vz']) > 0.1 else 0.0
        res.append((f0, v, rate, R, v * abs(rate) / 9.8, slip, a['wy']))
    return res

def main():
    wheelbase = 1.8
    for path in sys.argv[1:]:
        name = path.replace('\\', '/').split('/')[-1]
        rows = load(path)
        ang = 0
        for tok in name.split('_'):
            if tok.startswith('a') and tok[1:].isdigit():
                ang = int(tok[1:])
        Rg = wheelbase / math.tan(math.radians(ang)) if ang else float('inf')
        print(f'== {name}  steer {ang} deg  geometric R {Rg:.2f} m')
        print('  frame   v[m/s]  yaw[rad/s]   R[m]   lat[g]   slip[deg]   _WY')
        for f0, v, rate, R, g, slip, wy in analyse(rows):
            print(f'  {f0:5d}  {v:7.2f}  {rate:9.3f}  {R:7.2f}  {g:6.2f}  {slip:8.1f}  {wy:7.3f}')

main()
