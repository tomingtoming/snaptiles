import csv, sys, math
# servodiff.py <orig.csv> <snap.csv> <mode>   mode: rudder | hinge | sag
orig, snap, mode = sys.argv[1], sys.argv[2], sys.argv[3]
def load(f):
    return [{k: (float(v) if v not in ('', None) else None) for k, v in r.items()} for r in csv.DictReader(open(f))]
o, s = load(orig), load(snap)
def rel(rows, i, k, c):
    r = rows[i]
    return r[f'{k}{c}'] - r[f'{k}0'] if r.get(f'{k}{c}') is not None else None
def deg(x): return None if x is None else math.degrees(x)
frames = [25, 30, 31, 32, 33, 34, 35, 37, 40, 45, 50, 60, 90, 119, 120, 121, 122, 123, 125, 127, 130, 140, 160, 200, 239]
if mode == 'rudder':
    print('frame | orig ey1-ey0 (deg) | snap ey1-ey0 (deg)   (A: 0 -> 60 at 30, -> -60 at 120)')
    for f in frames:
        print(f'{f:4d} | {deg(rel(o, f-1, "ey", 1)):8.2f} | {deg(rel(s, f-1, "ey", 1)):8.2f}')
elif mode == 'hinge':
    print('frame | orig ex1-ex0 (deg)  y3-y0 | snap ex1-ex0 (deg)  y3-y0   (A: 0 -> -45 at 30, -> 0 at 120; chips 1 frame, 2,3 weights)')
    for f in frames:
        print(f'{f:4d} | {deg(rel(o, f-1, "ex", 1)):8.2f} {rel(o, f-1, "y", 3):7.3f} | {deg(rel(s, f-1, "ex", 1)):8.2f} {rel(s, f-1, "y", 3):7.3f}')
else:
    print('frame | orig ex1-ex0 (deg) ex2-ex0  y3-y0 | snap ex1-ex0 (deg) ex2-ex0  y3-y0   (arm of 2 frames + weight x4; chip 3 end weight)')
    for f in [5, 10, 20, 30, 60, 120, 200, 239]:
        print(f'{f:4d} | {deg(rel(o, f-1, "ex", 1)):8.2f} {deg(rel(o, f-1, "ex", 2)):8.2f} {rel(o, f-1, "y", 3):7.3f} | {deg(rel(s, f-1, "ex", 1)):8.2f} {deg(rel(s, f-1, "ex", 2)):8.2f} {rel(s, f-1, "y", 3):7.3f}')
