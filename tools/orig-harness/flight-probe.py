"""Compare the self-authored stock plane in the existing offline B26 namespace."""
import argparse, importlib.util, json, re, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('water_probe', HERE / 'water-probe.py')
water = importlib.util.module_from_spec(spec)
spec.loader.exec_module(water)
p = argparse.ArgumentParser()
p.add_argument('--power', type=int, choices=[10000,20000,40000,60000], required=True)
p.add_argument('--mode', choices=['plane','thrust','fixed-plane'], default='plane')
p.add_argument('--unbreakable', type=int, choices=[0,1], default=0)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
a.out.mkdir(exist_ok=True)
if any(a.out.iterdir()): raise SystemExit('Output directory must be empty')
source = (HERE.parents[1] / 'src/samples/plane.ts').read_text(encoding='utf-8').split(chr(96))[1]
source = re.sub(r'//[^\n]*', '', source)
source = re.sub(r'color=#[0-9a-fA-F]+', '', source)
source = source.replace('  function OnFrame()', '  local flightTick = 0\n  function OnFrame()\n    flightTick = flightTick + 1\n    THROTTLE = math.min(' + str(a.power) + ', math.max(0, flightTick - 90) * 600)')
if a.mode == 'fixed-plane':
 source = re.split(r'(?m)^Lua',source)[0] + 'Lua { local n=0 function OnFrame() n=n+1 THROTTLE=math.min(' + str(a.power) + ', math.max(0,n-90)*600) end }\n'
if a.mode == 'thrust':
 source = 'Val { POWER(default=' + str(a.power) + ',min=0,max=60000) }\nKey {}\nBody { Core(){ N:Jet(power=POWER){} S:Jet(power=POWER){} } }\n'
model = a.out / 'plane.txt'
model.write_text(source, encoding='utf-8')
terrain = a.out / 'terrain.json'
terrain.write_text(json.dumps({'ground':[-10000,10000,-1,0,-10000,10000], 'scenes':{'wide':{'solids':[]}}}))
water.LOGGER = '''n=0
buf="frame,y,vy,h,z,vz,pitch,x,yaw,vx,roll,weight"
function OnInit() n=0 end
function OnReset() end
function OnFrame()
 n=n+1
 _SETREG("U",UNBREAKABLE) _SETREG("A",AIR) _SETREG("G",GRAVITY) _SETREG("J",1) _SETREG("E",1)
 if n==1 then
  for c=0,_CHIPS()-1 do buf=buf..",parent"..c..",power"..c..",angle"..c end
  buf=buf.."\\n"
 end
 buf=buf..n..",".._Y(0)..",".._VY(0)..",".._H(0)..",".._Z(0)..",".._VZ(0)..",".._EX(0)..",".._X(0)..",".._EY(0)..",".._VX(0)..",".._EZ(0)..",".._WEIGHT()
 for c=0,_CHIPS()-1 do buf=buf..",".._GET(c,"PARENT")..",".._GET(c,"POWER")..",".._GET(c,"ANGLE") end
 buf=buf.."\\n"
 if n==LAST_FRAME then local f=_FOPEN("water.csv","w") if f>=0 then _FPUTS(f,buf) _FCLOSE(f) end end
end
'''.replace('UNBREAKABLE',str(a.unbreakable)).replace('AIR', '0' if a.mode == 'thrust' else '1').replace('GRAVITY','1' if a.mode == 'plane' else '0')
run = water.subprocess.run
def run_land(argv, **kwargs):
 if len(argv)>2 and str(argv[1]).endswith('make_land.py'):
  argv=list(argv); argv[2]=str(terrain)
  kwargs['env']={**kwargs['env'],'LAND_CELL':'1000'}
 return run(argv,**kwargs)
water.subprocess.run=run_land
# The inherited harness requires an empty output; retain exact inputs alongside its child output.
observations=a.out/'original'
sys.argv=[sys.argv[0],'0','--frames','900','--model-file',str(model),'--out',str(observations)]
water.main()
(a.out/'case.json').write_text(json.dumps({'mode':a.mode,'power':a.power,'unbreakable':a.unbreakable,'frames':900,'air':0 if a.mode == 'thrust' else 1,'gravity':1 if a.mode == 'plane' else 0,'ramp_start':None if a.mode == 'thrust' else 90,'ramp_per_frame':None if a.mode == 'thrust' else 600,'exe_sha256':water.EXPECTED},indent=2))
