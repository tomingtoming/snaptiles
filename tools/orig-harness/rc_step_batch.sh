#!/bin/bash
# Step probe batch (2026-10-31): the self-driving Basic car (Engine 2500) into 0.10/0.20/0.25 m steps.
D=$(dirname "$0")
for h in 0.10 0.20 0.25; do bash "$D/rc_step.sh" step${h/./}_p2500 $h 2500; done
