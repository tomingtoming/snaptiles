"""Black-box crash measurements using the existing isolated Wine runner.
Only self-authored models and observed CSV values are produced.
"""
import argparse
import importlib.util
from pathlib import Path
import sys
import json

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("water_probe", HERE / "water-probe.py")
water = importlib.util.module_from_spec(spec)
spec.loader.exec_module(water)

parser = argparse.ArgumentParser()
parser.add_argument("--height", type=float, required=True)
parser.add_argument("--unbreakable", type=int, choices=[0, 1], default=0)
parser.add_argument("--air", type=int, choices=[0, 1], default=1)
parser.add_argument("--tilt", type=float, default=0)
parser.add_argument("--part", choices=["Chip", "Frame", "Weight"], default="Chip")
parser.add_argument("--model-file", type=Path)
parser.add_argument("--pitch", type=float, default=0)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()

# Asymmetric arms exercise joints as well as direct ground contacts.
body = "Core(){ N:PART(){ N:PART(){} } S:PART(){} W:PART(){} E:PART(){} }".replace("PART", args.part)
water.model = lambda name, thrust: "Val {}\nKey {}\nBody {" + body + "}\n"
water.LOGGER = '''n=0
buf="frame,y,vy,h,z,vz,pitch,x,yaw"

function OnInit() n=0 end
function OnReset() end
function OnFrame()
 n=n+1
 if n==1 then
  for c=0,_CHIPS()-1 do buf=buf..",t"..c..",parent"..c..",top"..c..",y"..c..",hit"..c..",x"..c..",z"..c end
  buf=buf.."\\n"
 end
 _SETREG("U",UNBREAKABLE)
 _SETREG("A",AIR)
 if n==180 then
  _ENERVATE(0)
  _WARP(0,0,HEIGHT,0)
  _ROTATE(0,PITCH,0,TILT)
 end
 buf=buf..n..",".._Y(0)..",".._VY(0)..",".._H(0)..",".._Z(0)..",".._VZ(0)..",".._EX(0)..",".._X(0)..",".._EY(0)
 for c=0,_CHIPS()-1 do
  buf=buf..",".._T(c)..",".._GET(c,"PARENT")..",".._GET(c,"TOP")..",".._Y(c)..",".._GETHIT(c,"LAND")..",".._X(c)..",".._Z(c)
 end
 buf=buf.."\\n"
 if n==LAST_FRAME then
  local f=_FOPEN("water.csv","w")
  if f>=0 then _FPUTS(f,buf) _FCLOSE(f) end
 end
end
'''.replace("AIR", str(args.air)).replace("UNBREAKABLE", str(args.unbreakable)).replace("HEIGHT", str(args.height)).replace("TILT", str(args.tilt)).replace("PITCH", str(args.pitch))
sys.argv = [sys.argv[0], "0", "--frames", "600", "--out", str(args.out)]
if args.model_file:
    sys.argv.extend(["--model-file", str(args.model_file)])
# Capture the regulation HUD before the isolated process exits.
water.ISOLATE = water.ISOLATE.replace('test -s Resources/water.csv && exit 0',
    'if test -s Resources/water.csv; then xwd -root -silent -out /tmp/screen.xwd; exit 0; fi')
copyfile = water.shutil.copyfile
def copy_observation(src, dst, **kwargs):
    result = copyfile(src, dst, **kwargs)
    if Path(src).name == "water.csv":
        screenshot = Path(src).parents[2] / "screen.xwd"
        if screenshot.exists():
            water.subprocess.run(["convert", str(screenshot), str(Path(dst).with_suffix(".png"))], check=True)
    return result
water.shutil.copyfile = copy_observation
water.main()
(args.out / "case.json").write_text(json.dumps({**vars(args), "out": str(args.out), "model_file": str(args.model_file) if args.model_file else None, "exe_sha256": water.EXPECTED}, indent=2))
if args.model_file:
    copyfile(args.model_file, args.out / "model.txt")
else:
    (args.out / "model.txt").write_text(water.model("core", 0), encoding="ascii")
