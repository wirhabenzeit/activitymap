#!/bin/bash
# Download the Copernicus GLO-90 (or GLO-30) 1° tiles around every pass in passes.csv.
# usage: fetch-glo.sh <passes.csv> <out_dir> [90|30]   (GLO-90: 77 tiles, 319 MB; GLO-30: 2.3 GB)
set -eu
P=$1; D=$2; RES=${3:-90}
case $RES in 90) B=copernicus-dem-90m; C=30 ;; 30) B=copernicus-dem-30m; C=10 ;; esac
mkdir -p "$D"
# Each pass's tile plus neighbours within about 3 km of a tile edge.
python3 -I -c 'import csv, math, sys
for r in csv.DictReader(open(sys.argv[1])):
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            print(math.floor(float(r["lat"]) + a * 0.03), math.floor(float(r["lon"]) + b * 0.045))' "$P" | sort -u |
  while read -r a b; do n=$(printf 'Copernicus_DSM_COG_%s_N%02d_00_E%03d_00_DEM' $C $a $b); echo "https://$B.s3.amazonaws.com/$n/$n.tif"; done |
  # Sea tiles do not exist (HTTP error, exit 22); any other failure stops the run.
  (cd "$D" && xargs -P 16 -n 1 sh -c 'f=$(basename "$0"); [ -s "$f" ] && exit 0; curl -sf --retry 3 -o "$f" "$0"; s=$?; [ $s = 0 ] || [ $s = 22 ] || exit 255')
gdalbuildvrt -q "$D/glo.vrt" "$D"/*.tif
