"""Compare step-probe logs (original harness_step.rcs vs tools/step-compare.ts).
usage: stepdiff.py <h> <csv> [<csv> ...]   Heights are taken relative to each run's level ground."""
import csv, math, sys
h = float(sys.argv[1])
for path in sys.argv[2:]:
    rows = list(csv.DictReader(open(path)))
    F = lambda r, k: float(r[k])
    base = min(F(r, 'w0y') for r in rows[40:]) - 0.30  # wheel centre minus radius on the flat
    lead = max(range(4), key=lambda i: F(rows[60], f'w{i}z'))  # the wheels nearest +z lead
    leads = [i for i in range(4) if abs(F(rows[60], f'w{i}z') - F(rows[60], f'w{lead}z')) < 0.3]
    trails = [i for i in range(4) if i not in leads]
    hit = next((k for k, r in enumerate(rows) if F(r, f'w{lead}z') > 6.0 - 0.32), None)
    if hit is None: print(path, 'never reached the step'); continue
    v0 = math.hypot(F(rows[hit], 'vx'), F(rows[hit], 'vz'))
    win = rows[hit:hit + 90]
    speeds = [math.hypot(F(r, 'vx'), F(r, 'vz')) for r in win]
    up = lambda idx: next((k for k, r in enumerate(win) if all(F(r, f'w{i}y') - base > 0.30 + h - 0.03 for i in idx)), None)
    ex = [F(r, 'ex') for r in win]
    lift = max(F(r, 'y') for r in win) - (F(rows[hit - 1], 'y'))
    last = rows[-1]
    print(f"{path.split('/')[-1]:28s} v_hit={v0:5.2f} v_min={min(speeds):5.2f} (-{100*(1-min(speeds)/v0):4.1f}%) "
          f"pitch {min(ex):+.2f}..{max(ex):+.2f} rad  core rise {lift:+.2f} m  front up {up(leads)} fr  rear up {up(trails)} fr  "
          f"vy max {max(F(r,'vy') for r in win):+.2f}  end z {F(last,'z'):.1f} y {F(last,'y')-base:.2f}")
