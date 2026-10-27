import csv, sys
# compare core-relative chip positions: original (W=+x) vs SnapTiles (W=-x, so x is negated)
orig, mine = sys.argv[1], sys.argv[2]
def load(f):
    d = {}
    for r in csv.DictReader(open(f)):
        d[int(r['chip'])] = (int(r['type']), int(float(r['parent'])) if r['parent'] not in ('', 'undefined') else -1, float(r['x']), float(r['y']), float(r['z']))
    return d
o = load(orig); m = load(mine)
ox, oy, oz = o[0][2:5]; mx, my, mz = m[0][2:5]
print('chip type parent |  orig dx dy dz  |  snap dx dy dz  | err')
worst = []
for c in sorted(o):
    if c not in m: continue
    t, p, x, y, z = o[c]; t2, p2, x2, y2, z2 = m[c]
    a = (x - ox, y - oy, z - oz); b = (-(x2 - mx), y2 - my, z2 - mz)
    err = max(abs(a[i] - b[i]) for i in range(3))
    worst.append((err, c))
    if err > 0.08 and t != 9:
        print(f'{c:3d} {t:3d} {p:3d}/{p2:3d} | {a[0]:6.2f} {a[1]:6.2f} {a[2]:6.2f} | {b[0]:6.2f} {b[1]:6.2f} {b[2]:6.2f} | {err:.2f}')
worst.sort(reverse=True)
print('max err', worst[0], 'chips over 0.08:', sum(1 for e, c in worst if e > 0.08), 'of', len(worst))
