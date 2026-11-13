#!/bin/bash
# Tile and run prominence one 1-degree latitude band at a time, deleting each band's FLT tiles
# afterwards, then merge all divide trees. Peak disk use is one band of tiles (about 4 GB).
# usage: SRCS="low.vrt ... high.vrt" prominence-bands.sh <tiles.txt> <out_dir> <work_dir> <kirmse_release_dir>
# tiles.txt has one "lon lat name" line per tile (lower-left corner, FLT file name).
set -u
TILES=$1; OUT=$2; WORK=$3; B=$4
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT" "$WORK/tmp"
# Bounds cover every band; tiles missing from a band's input directory are skipped.
BOUNDS=$(awk 'NR==1{s=n=$2; w=e=$1} {if($2<s)s=$2; if($2>n)n=$2; if($1<w)w=$1; if($1>e)e=$1}
  END {printf "%d %d %d %d", int(s), int(n)+1, int(w), int(e)+1}' "$TILES")
for lat in $(awk '{print int($2)}' "$TILES" | sort -nu); do
  [ -e "$OUT/band_$lat.done" ] && continue
  T=$WORK/band; rm -rf "$T"; mkdir -p "$T" "$OUT/band_$lat"
  awk -v l="$lat" 'int($2)==l' "$TILES" |
    xargs -P 8 -L 1 sh -c '"$0" '"'$T' '$WORK/tmp'"' "$1" "$2" "$3"' "$HERE/dem-tile.sh" >> "$WORK/tiles.log" 2>> "$WORK/tiles.err"
  "$B/prominence" --v=1 -f CUSTOM-0.1-1200 -i "$T" -o "$OUT/band_$lat" -t 12 -m 10 -- $BOUNDS >> "$WORK/prominence.log" 2>&1 &&
    touch "$OUT/band_$lat.done"
  rm -rf "$T"
done
# Relative paths keep the argument list short enough for several thousand tiles.
cd "$OUT" && "$B/merge_divide_trees" --v=1 -f -t 12 -m 10 -s 1 results band_*/*_pruned_*.dvt >> "$WORK/prominence.log" 2>&1
wc -l "$OUT/results.txt"
