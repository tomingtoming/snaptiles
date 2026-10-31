"""Rank corpus driving divergences (tier 3): original runs/drive/<n>.<mode>.csv (land at 150 m) against
SnapTiles runs/drive/snap/<n>.<mode>.csv. Trajectories are taken relative to the start position and compared
frame by frame until either leaves the 400 m probe land. usage: driverank.py <runs/drive> <runs/geom> [top]"""
import csv, math, os, sys
d, g = sys.argv[1], sys.argv[2]; top = int(sys.argv[3]) if len(sys.argv) > 3 else 40
idx = dict(l.rstrip('\n').split('\t', 1) for l in open(os.path.join(g, 'index.tsv'), encoding='utf-8') if l.strip())
def load(p, base):
    out = []
    for r in csv.DictReader(open(p, encoding='utf-8', errors='replace')):
        try: out.append({k: float(v) for k, v in r.items()})
        except ValueError: continue
        out[-1]['y'] -= base
    return out
up = lambda r: abs(r['ex']) < 0.6 and abs(r['ez']) < 0.6
rows, missing = [], []
for name in sorted(os.listdir(d)):
    if not name.endswith('.csv'): continue
    n, mode = name.split('.')[:2]
    sp = os.path.join(d, os.environ.get('SNAP_DIR', 'snap'), name)
    if not os.path.exists(sp):
        err = sp[:-4] + '.err'; missing.append((n, mode, open(err).read()[:70] if os.path.exists(err) else 'no replay')); continue
    o, s = load(os.path.join(d, name), 150.0), load(sp, 0.0)
    k = min(len(o), len(s))
    if k < 40: continue
    o0, s0 = o[30], s[30]  # after the spawn drop
    rel = lambda r, r0: (r['x'] - r0['x'], r['y'], r['z'] - r0['z'])
    k = next((i for i in range(30, k) if max(abs(rel(o[i], o0)[0]), abs(rel(o[i], o0)[2]), abs(rel(s[i], s0)[0]), abs(rel(s[i], s0)[2])) > 180), k)
    errs = [math.dist(rel(o[i], o0), rel(s[i], s0)) for i in range(30, k)]
    disp = lambda rows, r0: math.hypot(rows[k - 1]['x'] - r0['x'], rows[k - 1]['z'] - r0['z'])
    vmax = lambda rows: max(math.sqrt(r['vx'] ** 2 + r['vy'] ** 2 + r['vz'] ** 2) for r in rows[30:k])
    hmax = lambda rows: max(r['y'] for r in rows[30:k])
    mean = sum(errs) / len(errs)
    od, sd = disp(o, o0), disp(s, s0)
    score = mean / max(1.0, 0.5 * max(od, sd)) + (0 if up(o[k - 1]) == up(s[k - 1]) else 1)
    rows.append((score, n, mode, mean, od, sd, vmax(o), vmax(s), hmax(o), hmax(s), up(o[k - 1]), up(s[k - 1]), idx.get(n, '?')))
print(f"{'n':>3} {'mode':4} {'score':>5} | {'mean err':>8} | disp o/s | vmax o/s | hmax o/s | upright o/s | model")
for r in sorted(rows, reverse=True)[:top]:
    print(f"{r[1]:>3} {r[2]:4} {r[0]:5.2f} | {r[3]:8.2f} | {r[4]:6.1f}/{r[5]:<6.1f} | {r[6]:5.1f}/{r[7]:<5.1f} | {r[8]:5.1f}/{r[9]:<5.1f} | {'up' if r[10] else 'DOWN'}/{'up' if r[11] else 'DOWN'} | {r[12]}")
print(f"compared {len(rows)}; without replay {len(missing)}")
for m in missing[:20]: print('  missing', *m)
