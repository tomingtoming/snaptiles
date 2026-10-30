"""Write the body of a DirectX text land (Header + one Mesh) for the step probe: a 1000 m flat square
at y=BASE (above the original's sea, which slowed a car on a y=0 land to 0.5 m/s) and a box `h` m tall spanning x -10..10, z Z0..Z0+30 (the Basic car drives toward +z).
rc_step.sh prepends the template block of the original Resources/Land.x. usage: make_step_land.py h out"""
import sys
h, out = float(sys.argv[1]), sys.argv[2]
Z0, Z1, X = 6.0, 36.0, 10.0
BASE = 50.0
CELL = 4.0  # a single 1000 m ground quad left the Basic car crawling at 0.5 m/s; small cells drive normally
def grid(x0, x1, z0, z1, y):
    out, x = [], x0
    while x < x1 - 1e-9:
        z = z0
        while z < z1 - 1e-9:
            xa, za = min(x + CELL, x1), min(z + CELL, z1)
            out.append(([(x, y, z), (x, y, za), (xa, y, za), (xa, y, z)], (0, 1, 0)))
            z = za
        x = xa
    return out
# the material's Emissive row is the original's rolling/static/dynamic friction (readme 15B11): keep 0 like Land.x
# ground everywhere in -60..60 x -40..80 except under the step's top
quads = [q for q in grid(-60, 60, -40, 80, 0) if not (-X <= q[0][0][0] < X and Z0 <= q[0][0][2] < Z1)]
quads += grid(-X, X, Z0, Z1, h)
quads += [
    ([(-X, 0, Z0), (-X, h, Z0), (X, h, Z0), (X, 0, Z0)], (0, 0, -1)),
    ([(X, 0, Z1), (X, h, Z1), (-X, h, Z1), (-X, 0, Z1)], (0, 0, 1)),
    ([(-X, 0, Z1), (-X, h, Z1), (-X, h, Z0), (-X, 0, Z0)], (-1, 0, 0)),
    ([(X, 0, Z0), (X, h, Z0), (X, h, Z1), (X, 0, Z1)], (1, 0, 0)),
]
v, f, n = [], [], []
for corners, normal in quads:
    b = len(v)
    v += [(x, y + BASE, z) for x, y, z in corners]
    # DirectX is left-handed: clockwise winding seen from the normal side
    f += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    n += [normal] * 4
fmt = lambda t: ";".join(f"{x:.6f}" for x in t)
L = ["Header{", "1;", "0;", "1;", "}", "Mesh {", f" {len(v)};"]
L += [f" {fmt(p)};" + ("," if i < len(v) - 1 else ";") for i, p in enumerate(v)]
L += [f" {len(f)};"] + [f" 3;{a},{b},{c};" + ("," if i < len(f) - 1 else ";") for i, (a, b, c) in enumerate(f)]
L += [" MeshMaterialList {", "  1;", f"  {len(f)};"] + [f"  0" + ("," if i < len(f) - 1 else ";") for i in range(len(f))]
L += ["  Material {", "   0.600000;0.650000;0.600000;1.000000;;", "   5.000000;", "   0.000000;0.000000;0.000000;;", "   0.000000;0.000000;0.000000;;", "  }", " }"]
L += [" MeshNormals {", f"  {len(n)};"] + [f"  {fmt(p)};" + ("," if i < len(n) - 1 else ";") for i, p in enumerate(n)]
L += [f"  {len(f)};"] + [f"  3;{a},{b},{c};" + ("," if i < len(f) - 1 else ";") for i, (a, b, c) in enumerate(f)] + [" }"]
L += [" MeshTextureCoords {", f"  {len(v)};"] + [f"  {p[0]/4:.4f};{p[2]/4:.4f};" + ("," if i < len(v) - 1 else ";") for i, p in enumerate(v)] + [" }", "}"]
open(out, "w", newline="\n").write("\n".join(L) + "\n")
