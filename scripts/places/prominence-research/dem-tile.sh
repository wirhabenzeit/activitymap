#!/bin/sh
# Build one 0.1-degree Float32 FLT tile for Kirmse's prominence tool (CUSTOM-0.1-1200 format).
# usage: SRCS="low.vrt ... high.vrt" dem-tile.sh <out_dir> <tmp_dir> <lon> <lat> <name>
# SRCS lists terrain sources lowest priority first; later sources overwrite earlier ones where they have data.
# The loader takes position from the file name (upper-left corner), and samples sit on tile edges
# with one pixel of overlap, so spacing is 0.1/1199 degrees.
OUT=$1; TMP=$2; X=$3; Y=$4; NAME=$5
[ -s "$OUT/$NAME" ] && exit 0
H=$(echo "scale=12; 0.1 / 1199 / 2" | bc)
X1=$(echo "$X - $H" | bc); Y1=$(echo "$Y - $H" | bc); X2=$(echo "$X + 0.1 + $H" | bc); Y2=$(echo "$Y + 0.1 + $H" | bc)
T="$TMP/${NAME%.flt}.tif"
# Warping straight to EHdr under EMPTY_DIR writes a truncated file, so warp to GeoTIFF first.
GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR gdalwarp -q -overwrite -t_srs EPSG:4326 -te $X1 $Y1 $X2 $Y2 -ts 1200 1200 -r bilinear -ovr NONE \
  -dstnodata -999999 -ot Float32 -wm 256 $SRCS "$T" &&
GDAL_DISABLE_READDIR_ON_OPEN=FALSE gdal_translate -q -of EHdr -ot Float32 -a_nodata -999999 "$T" "$OUT/$NAME" && echo "$NAME" || echo "FAIL $NAME" >&2
rm -f "$T"
