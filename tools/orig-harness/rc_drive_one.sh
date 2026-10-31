#!/bin/bash
# Smoke test of rc_drive_corpus.sh on a temporary index with one model (default n=3, tonbo_202).
D=$(cd "$(dirname "$0")" && pwd); G=/mnt/d/snaptiles-models/quarantine/original/runs/geom
n=${1:-3}
cp "$G/index.tsv" /tmp/index.full; grep -P "^$n\t" /tmp/index.full > "$G/index.tsv"
bash "$D/rc_drive_corpus.sh"; cp /tmp/index.full "$G/index.tsv"
