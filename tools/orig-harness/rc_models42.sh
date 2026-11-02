#!/bin/bash
# spring joints under a landing load: a body (Core, two Chips, four Weights) standing on two legs that leave the N and
# S Chips folded A° down through a spring joint, each ending in a level Frame foot. Dropped from the spawn height;
# harness_land.rcs logs chips 0..19 every frame. land_<A>_<spring>_<damper>[_h]: the body carries four pairs of Weights, _h four triples.
M=${M:-$HOME/rc/models}
mk() { # name A spring damper bodyweight
cat > "$M/$1.txt" <<EOT
Val { A(default=0,min=-180,max=180) }
Key { }
Body { Core(){ N:Chip(){ N:Frame(angle=$2,spring=$3,damper=$4){ N:Frame(angle=-$2){ } } W:$5 E:$5 } S:Chip(){ S:Frame(angle=$2,spring=$3,damper=$4){ S:Frame(angle=-$2){ } } W:$5 E:$5 } } }
Lua {
function OnFrame()
end
}
EOT
}
W2='Weight(){ W:Weight(){ } }'
W3='Weight(){ W:Weight(){ W:Weight(){ } } }'
# legs 30° down carry the body on a 0.52 m lever: spring 0.2 dips ~0.08 m on landing in SnapTiles, 0.05 bottoms out
mk land_30_0.2_0.5 30 0.2 0.5 "$W2"
mk land_30_0.1_0.5 30 0.1 0.5 "$W2"
mk land_30_0.05_0.5 30 0.05 0.5 "$W2"
mk land_30_0.1_0 30 0.1 0 "$W2"
mk land_30_0.1_1 30 0.1 1 "$W2"
mk land_30_1_0.5 30 1 0.5 "$W2"
mk land_30_0.1_0.5_h 30 0.1 0.5 "$W3"
mk land_60_0.2_0.5 60 0.2 0.5 "$W2"
for f in "$M"/land_*.txt; do echo "$(basename $f) $(grep -o '{' $f | wc -l) $(grep -o '}' $f | wc -l)"; done
