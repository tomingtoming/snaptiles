"""Rank corpus models by geometry divergence (original runs/geom/<n>.g{1,30}.csv vs snap/<n>...).
Positions are taken relative to the core (both logs come from the Lua API, which already uses the original's frame).
usage: geomrank.py <runs/geom dir> [top]"""
import csv, math, os, sys
d = sys.argv[1]; top = int(sys.argv[2]) if len(sys.argv) > 2 else 30
idx = dict(l.rstrip('\n').split('\t', 1) for l in open(os.path.join(d, 'index.tsv'), encoding='utf-8') if l.strip())
def load(p, mirror):
    rows = {}
    for r in csv.DictReader(open(p, encoding='utf-8', errors='replace')):
        try: rows[int(float(r['chip']))] = (int(float(r['type'])), (-1 if mirror else 1) * float(r['x']), float(r['y']), float(r['z']))
        except (ValueError, KeyError): pass
    return rows
out, missing = [], []
for n, path in idx.items():
    o1, o30 = (os.path.join(d, f'{n}.g{k}.csv') for k in (1, 30))
    s1, s30 = (os.path.join(d, 'snap', f'{n}.g{k}.csv') for k in (1, 30))
    if not os.path.exists(o30): continue
    if not os.path.exists(s30):
        err = os.path.join(d, 'snap', f'{n}.err')
        missing.append((n, path, open(err).read()[:80] if os.path.exists(err) else 'no snap output')); continue
    res = []
    for op, sp in ((o1, s1), (o30, s30)):
        o, s = load(op, False), load(sp, False)  # SnapTiles' _X already reports the original's left-handed x
        if not o or not s or 0 not in o or 0 not in s: res.append((None,) * 4); continue
        oc, sc = o[0][1:], s[0][1:]
        common = [c for c in o if c in s]
        err = [math.dist([o[c][i] - oc[i - 1] for i in (1, 2, 3)], [s[c][i] - sc[i - 1] for i in (1, 2, 3)]) for c in common]
        worst = max(range(len(common)), key=lambda i: err[i]) if err else 0
        res.append((max(err) if err else 0, len(o), len(s), common[worst] if common else -1))
    (e1, no, ns, w1), (e30, _, _, w30) = res
    out.append((e30 or 0, n, path, e1, e30, no, ns, w30))
print(f"{'n':>3} {'g1 err':>7} {'g30 err':>7} chips o/s worst | model")
for e, n, path, e1, e30, no, ns, w in sorted(out, key=lambda r: -r[0])[:top]:
    print(f"{n:>3} {e1 if e1 is not None else -1:7.3f} {e30 if e30 is not None else -1:7.3f} {no:>4}/{ns:<4} {w:>4} | {path}")
print(f"compared {len(out)}, without SnapTiles output {len(missing)}")
for m in missing: print('  missing', *m)
