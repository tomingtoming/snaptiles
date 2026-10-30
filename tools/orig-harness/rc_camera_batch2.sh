#!/bin/bash
# Second camera batch (2026-10-30): distance vs speed (A, F), spectator re-placement (B, G at two speeds),
# yaw step response (A, F on a turntable), mouse on the view, zoom persistence across views.
D=$(dirname "$0"); M=$HOME/rc/models
case "${1:-all}" in
  1|all)
    bash "$D/rc_camera.sh" straightA "$M/cam_straight.txt" 40 FIXVIEW=0
    bash "$D/rc_camera.sh" straightF "$M/cam_straight.txt" 40 FIXVIEW=5
    bash "$D/rc_camera.sh" straightB "$M/cam_straight.txt" 40 FIXVIEW=1
    bash "$D/rc_camera.sh" fastB "$M/cam_fast.txt" 40 FIXVIEW=1
    bash "$D/rc_camera.sh" fastG "$M/cam_fast.txt" 40 FIXVIEW=6 ;;&
  2|all)
    bash "$D/rc_camera.sh" straightG "$M/cam_straight.txt" 40 FIXVIEW=6
    bash "$D/rc_camera.sh" spinA "$M/cam_spin.txt" 40 FIXVIEW=0
    bash "$D/rc_camera.sh" spinF "$M/cam_spin.txt" 40 FIXVIEW=5
    bash "$D/rc_camera.sh" mouseA "$M/cam_parked.txt" 36 VIEWSET=0 dragL:200:0@10 dragL:0:120@13 dragR:200:0@16 dragR:0:120@19 wheelU@22 wheelU@23 wheelD@25 wheelD@26 wheelD@27
    bash "$D/rc_camera.sh" zoomper "$M/cam_parked.txt" 34 VIEWSET=0 i@9 i@10 F9@12 i@14 F8@16 F12@18 F8@20 o@22 F9@24 ;;
esac
