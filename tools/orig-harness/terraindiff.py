"""Rank terrain-probe divergences: original logs (runs/terrain/<scene>_p2500.csv, land lifted by 50 m) against
SnapTiles replays (runs/terrain/snap/...). usage: terraindiff.py <runs/terrain dir>"""
import csv, math, os, sys
d = sys.argv[1]
def load(p, base):
    rows = list(csv.DictReader(open(p)))
    out = []
    for r in rows:
        f = {k: float(v) for k, v in r.items()}
        f['y'] -= base
        f['v'] = math.hypot(f['vx'], f['vz'])
        out.append(f)
    return out
res = []
for name in sorted(os.listdir(d)):
    if not name.endswith('.csv') or '_p2500' not in name: continue
    base = float(name.split('_b')[-1][:-4]) if '_b' in name else 50.0  # rc_terrain.sh LAND_BASE runs
    sp = os.path.join(d, 'snap', name.split('_b')[0] + ('' if name.endswith('_p2500.csv') else '.csv'))
    if not os.path.exists(sp): continue
    o, s = load(os.path.join(d, name), base), load(sp, 0.0)
    n = min(len(o), len(s))
    # stop at z = 200: the original's land stops colliding near z = 210 (the flat run fell through there)
    n = next((i for i in range(n) if o[i]['z'] > 200 or s[i]['z'] > 200), n)
    rng = range(30, n)
    vr = math.sqrt(sum((o[i]['v'] - s[i]['v']) ** 2 for i in rng) / len(rng))
    vmean = sum(o[i]['v'] for i in rng) / len(rng) or 1
    yr = math.sqrt(sum((o[i]['y'] - s[i]['y']) ** 2 for i in rng) / len(rng))
    zo, zs = o[n - 1]['z'], s[n - 1]['z']
    px = lambda rows: max(abs(r['ex']) for r in rows[30:n])
    rx = lambda rows: max(abs(r['ez']) for r in rows[30:n])
    up = lambda r: 'up' if abs(r['ex']) < 0.6 and abs(r['ez']) < 0.6 else 'TIPPED'
    score = vr / vmean + yr
    res.append((score, name[:-4].replace('_p2500', ''), n, zo, zs, vr, yr, px(o), px(s), rx(o), rx(s), up(o[n - 1]), up(s[n - 1])))
print(f"{'scene':9s} {'frames':>6s} {'score':>5s} | z_end orig/snap | v rms | y rms | pitch max o/s | roll max o/s | end o/s")
for r in sorted(res, reverse=True):
    print(f"{r[1]:9s} {r[2]:6d} {r[0]:5.2f} | {r[3]:6.1f} / {r[4]:6.1f} | {r[5]:5.2f} | {r[6]:5.2f} | {r[7]:4.2f} / {r[8]:4.2f} | {r[9]:4.2f} / {r[10]:4.2f} | {r[11]} / {r[12]}")
