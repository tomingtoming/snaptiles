import csv, sys, math
# aerodiff.py <runs dir> <snap dir>: prints speed/height traces of the aero probes, original vs SnapTiles
runs, snap = sys.argv[1], sys.argv[2]
names = ['aero_flat', 'aero_broad', 'aero_broad2', 'aero_tilt10', 'aero_tiltm10', 'aero_tilt20', 'aero_tilt45']
def load(f):
    try:
        return [{k: (float(v) if v not in ('', None) else None) for k, v in r.items()} for r in csv.DictReader(open(f))]
    except FileNotFoundError:
        return None
for n in names:
    o = load(f'{runs}/{n}.csv'); s = load(f'{snap}/snap_{n}.csv')
    print(f'== {n}')
    print(' frame |  orig  speed   y-y0   pitch(ex) |  snap  speed   y-y0   pitch(ex)')
    for fr in (30, 60, 90, 120, 180, 240, 300, 329):
        def row(rows):
            if rows is None or fr - 1 >= len(rows): return '   -       -       -   '
            r = rows[fr - 1]; r0 = rows[0]
            sp = math.hypot(r['vx'], r['vy'], r['vz'])
            # original logs model-local velocity; speed magnitude is frame-independent
            return f'{sp:7.2f} {r["y"] - r0["y"]:7.2f} {math.degrees(r["ex"]):8.1f}'
        print(f'{fr:6d} | {row(o)} | {row(s)}')
