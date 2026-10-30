#!/bin/bash
# Re-run of the fixed-view cases of rc_camera_batch2.sh after FIXVIEW was wired into rc_camera.sh.
D=$(dirname "$0"); M=$HOME/rc/models
bash "$D/rc_camera.sh" straightF "$M/cam_straight.txt" 40 FIXVIEW=5
bash "$D/rc_camera.sh" straightB "$M/cam_straight.txt" 40 FIXVIEW=1
bash "$D/rc_camera.sh" fastB "$M/cam_fast.txt" 40 FIXVIEW=1
bash "$D/rc_camera.sh" fastG "$M/cam_fast.txt" 40 FIXVIEW=6
bash "$D/rc_camera.sh" straightG "$M/cam_straight.txt" 40 FIXVIEW=6
bash "$D/rc_camera.sh" spinF "$M/cam_spin.txt" 40 FIXVIEW=5
