"""Measure an unpowered model on flat land on either side of the original sea.
Run under the existing quarantined WSL installation. No original files are shipped.
The optional output directory must be empty; CSV files record only observations.
"""
import argparse
import csv
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
EXPECTED = "872ee04f7b432afa169542718c4447172abf9cd28478bea8872d4305622ef199"
PARTS = {"core": None, "chips": "Chip()", "frames": "Frame()", "weights": "Weight()", "heavy": "Weight(option=3)"}


def model(name):
    part = PARTS[name]
    arms = " ".join(f"{side}:{part}{{}}" for side in ("N", "S", "W", "E")) if part else ""
    return "Val {}\nKey {}\nBody { Core(){" + arms + "} }\n"

LOGGER = """n=0
buf="frame,y,vy,h\\n"
function OnInit() n=0 end
function OnReset() end
function OnFrame()
  n=n+1
  buf=buf..n..",".._Y(0)..",".._VY(0)..",".._H(0).."\\n"
  if n==180 then
    local f=_FOPEN("water.csv","w")
    if f>=0 then _FPUTS(f,buf) _FCLOSE(f) end
  end
end
"""
# Only this case's directory remains reachable through /tmp. The namespace
# has no host network, user home, Windows drives, WSL sockets or host processes.
ISOLATE = r"""
set -eu
mount --make-rprivate /
mount --bind "$1" /tmp
for path in /mnt /home /run; do mount -t tmpfs tmpfs "$path"; done
cd /tmp/game
export HOME=/tmp/home WINEPREFIX=/tmp/prefix WINEARCH=win32 WINEDEBUG=-all
export LIBGL_ALWAYS_SOFTWARE=1 WINEDLLOVERRIDES=winemenubuilder.exe=d
unset WSL_INTEROP DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix
Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>/tmp/xdisplay >/tmp/xlog 2>&1 &
xpid=$!
for i in $(seq 1 80); do
  test -s /tmp/xdisplay && break
  kill -0 "$xpid" || { cat /tmp/xlog; exit 1; }
  sleep 0.1
done
test -s /tmp/xdisplay || { cat /tmp/xlog; exit 1; }
export DISPLAY=:$(cat /tmp/xdisplay)
wine ./RigidChips15B26.exe >/tmp/wine.log 2>&1 &
pid=$!
for i in $(seq 1 100); do
  test -s Resources/water.csv && exit 0
  kill -0 "$pid" || exit 1
  sleep 0.5
done
exit 1
"""


def main():
    args = argparse.ArgumentParser()
    args.add_argument("bases", nargs="+", type=int)
    args.add_argument("--out", type=Path)
    args.add_argument("--model", choices=PARTS, default="core")
    opts = args.parse_args()
    original = Path.home() / "rc/RC15B26"
    if hashlib.sha256((original / "RigidChips15B26.exe").read_bytes()).hexdigest() != EXPECTED:
        raise SystemExit("Unexpected executable hash")
    if opts.out:
        opts.out.mkdir(exist_ok=True)
        if any(opts.out.iterdir()):
            raise SystemExit("Output directory must be empty")
    with tempfile.TemporaryDirectory(prefix="snaptiles-water-", dir="/tmp") as scratch:
        work = Path(scratch)
        shutil.copytree(original, work / "game", symlinks=True)
        shutil.copytree(Path.home() / ".wine-rc", work / "prefix", symlinks=True)
        (work / "home").mkdir()
        resources = work / "game/Resources"
        (resources / "Basic.txt").write_text(model(opts.model), encoding="ascii")
        (resources / "System.rcs").write_text(LOGGER, encoding="ascii")
        template = b"".join((resources / "Land.x.orig").read_bytes().splitlines(keepends=True)[:127])
        for base in opts.bases:
            csv_path = resources / "water.csv"
            csv_path.unlink(missing_ok=True)
            body = work / "land-body.x"
            subprocess.run([sys.executable, HERE / "make_land.py", HERE / "terrains.json", "wide", body],
                           env={**os.environ, "LAND_BASE": str(base), "LAND_CELL": "50"}, check=True)
            (resources / "Land.x").write_bytes(template + body.read_bytes())
            run = subprocess.run(["unshare", "--user", "--map-root-user", "--mount", "--net", "--pid",
                                  "--fork", "--kill-child", "--mount-proc", "sh", "-c", ISOLATE, "probe", scratch],
                                 timeout=65)
            if run.returncode or not csv_path.is_file():
                log = work / "wine.log"
                detail = log.read_text(errors="replace")[-1500:] if log.exists() else ""
                raise RuntimeError(f"No observation at land base {base}: {detail}")
            rows = list(csv.DictReader(csv_path.read_text().splitlines()))
            if len(rows) != 180:
                raise RuntimeError(f"Incomplete observation at {base}: {len(rows)} frames")
            if opts.out:
                shutil.copyfile(csv_path, opts.out / f"{opts.model}_base{base}.csv")
            print(f"{opts.model} base {base}", [(r["frame"], round(float(r["y"]), 4), round(float(r["vy"]), 4),
                                   round(float(r["h"]), 4)) for r in rows if int(r["frame"]) in (1, 10, 20, 60, 180)],
                  flush=True)


if __name__ == "__main__":
    main()
