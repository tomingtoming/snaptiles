"""Write the Header+Mesh body of a DirectX text land for one scene of terrains.json (rc_terrain.sh prepends
the original's template block). usage: make_land.py <terrains.json> <scene> <out.body>
Faces are split into <= LAND_CELL m quads (4 by default; the 400 m "wide" land uses 50: 20k faces ran at ~1 fps), the
land is lifted to y = BASE (above the original's sea) and every material keeps Emissive 0: that row is the
original's rolling/static/dynamic friction (readme 15B11)."""
import json, sys
spec, scene, out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
import os
BASE, CELL = float(os.environ.get("LAND_BASE", 50.0)), float(os.environ.get("LAND_CELL", 4.0))  # at 50 a 1 m drop and the 30° ramp fell into the sea; rc_terrain_high.sh uses 150
sc = spec['scenes'][scene]
grounds = sc.get('ground', [spec['ground']])
if grounds and not isinstance(grounds[0], list): grounds = [grounds]
quads = []
def split(a, b, c, d):
    """a..d corners of a planar quad (a->b and a->d edges); emit sub-quads no longer than CELL."""
    import math
    lab = math.dist(a, b); lad = math.dist(a, d)
    nu, nv = max(1, math.ceil(lab / CELL)), max(1, math.ceil(lad / CELL))
    P = lambda u, v: tuple(a[i] + (b[i] - a[i]) * u + (d[i] - a[i]) * v + (c[i] - b[i] - d[i] + a[i]) * u * v for i in range(3))
    for i in range(nu):
        for j in range(nv):
            quads.append((P(i / nu, j / nv), P((i + 1) / nu, j / nv), P((i + 1) / nu, (j + 1) / nv), P(i / nu, (j + 1) / nv)))
def box(x0, x1, y0, y1, z0, z1):
    split((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0))  # top
    split((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1))  # bottom
    split((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0))  # -z
    split((x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z1))  # +z
    split((x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0))  # -x
    split((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1))  # +x
def ramp(x0, x1, z0, z1, h):
    split((x0, 0, z0), (x0, h, z1), (x1, h, z1), (x1, 0, z0))      # slope
    split((x1, 0, z1), (x1, h, z1), (x0, h, z1), (x0, 0, z1))      # back
    for x, s in ((x0, -1), (x1, 1)):                                 # side triangles as degenerate quads
        quads.append(((x, 0, z0), (x, h, z1), (x, 0, z1), (x, 0, z1)) if s < 0 else ((x, 0, z0), (x, 0, z1), (x, h, z1), (x, h, z1)))
for g in grounds: box(*g)
for s in sc['solids']:
    if 'box' in s: box(*s['box'])
    else:
        x0, x1, z0, z1, h, zend = s['ramp']
        ramp(x0, x1, z0, z1, h)
        box(x0, x1, 0, h, z1, zend)
v, f = [], []
for q in quads:
    b = len(v); v += [(x, y + BASE, z) for x, y, z in q]
    f += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
def normal(a, b, c):
    u = [b[i] - a[i] for i in range(3)]; w = [c[i] - a[i] for i in range(3)]
    n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
    l = sum(x * x for x in n) ** 0.5 or 1
    return tuple(x / l for x in n)
fn = [normal(v[a], v[b], v[c]) for a, b, c in f]
fmt = lambda t: ";".join(f"{x:.5f}" for x in t)
sep = lambda i, n: "," if i < n - 1 else ";"
L = ["Header{", "1;", "0;", "1;", "}", "Mesh {", f" {len(v)};"]
L += [f" {fmt(p)};{sep(i, len(v))}" for i, p in enumerate(v)]
L += [f" {len(f)};"] + [f" 3;{a},{b},{c};{sep(i, len(f))}" for i, (a, b, c) in enumerate(f)]
L += [" MeshMaterialList {", "  1;", f"  {len(f)};"] + [f"  0{sep(i, len(f))}" for i in range(len(f))]
L += ["  Material {", "   0.600000;0.650000;0.600000;1.000000;;", "   5.000000;", "   0.000000;0.000000;0.000000;;", "   0.000000;0.000000;0.000000;;", "  }", " }"]
L += [" MeshNormals {", f"  {len(fn)};"] + [f"  {fmt(n)};{sep(i, len(fn))}" for i, n in enumerate(fn)]
L += [f"  {len(f)};"] + [f"  3;{i},{i},{i};{sep(i, len(f))}" for i in range(len(f))] + [" }"]
L += [" MeshTextureCoords {", f"  {len(v)};"] + [f"  {p[0] / 4:.4f};{p[2] / 4:.4f};{sep(i, len(v))}" for i, p in enumerate(v)] + [" }", "}"]
open(out, "w", newline="\n").write("\n".join(L) + "\n")
print(scene, len(f), "faces")
