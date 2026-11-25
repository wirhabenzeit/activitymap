#!/bin/bash
# Fetch or prepare the terrain sources used by the prominence trials (issue #462 research).
# usage: fetch-sources.sh <data_dir> {swissalti3d|bev|tinitaly|glo30|wikidata}
# Each step writes into its own subdirectory of <data_dir>. Sizes are as measured in October 2026.
set -eu
D=$1; HERE=$(cd "$(dirname "$0")" && pwd)
UA=prominence-trial
case $2 in
swissalti3d)
  # 43,650 latest 1 km tiles at 2 m, averaged to 5 m while reading remotely: 3.5 GB on disk, about 20 min.
  mkdir -p "$D/alti5"
  python3 -I "$HERE/swissalti3d-list.py" "$D/alti_items.tsv"
  awk -F'\t' '{split($1,a,"_"); print a[3]"\t"a[2]"\t"$2}' "$D/alti_items.tsv" | sort -k1,1 -k2,2n |
    awk -F'\t' '{u[$1]=$3} END{for(k in u) print k"\t"u[k]}' | sort > "$D/alti_latest.tsv"
  cut -f1,2 "$D/alti_latest.tsv" | GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR GDAL_HTTP_MAX_RETRY=5 GDAL_HTTP_RETRY_DELAY=2 \
    xargs -P 32 -n 2 sh -c '[ -s "'"$D"'/alti5/$0.tif" ] || gdal_translate -q -outsize 200 200 -r average -co COMPRESS=DEFLATE -co PREDICTOR=3 "/vsicurl/$1" "'"$D"'/alti5/$0.tif"'
  find "$D/alti5" -name '*.tif' > "$D/alti_list.txt"
  gdalbuildvrt -q -input_file_list "$D/alti_list.txt" "$D/alti.vrt" ;;
bev)
  # BEV ALS DTM: 55 Cloud-Optimised GeoTIFFs of 50 km (1 m, 408 GB in total), read remotely at the 4 m overview.
  # Nothing is downloaded; the tile list is in bev-dtm-tiles.txt.
  mkdir -p "$D/bev"
  while read -r name; do
    srs=; [ "$name" = N2750000E4850000 ] && srs="-a_srs EPSG:3035"  # this tile has no CRS
    GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR gdal_translate -q -of VRT -oo OVERVIEW_LEVEL=1 $srs \
      "/vsicurl/https://data.bev.gv.at/download/ALS/DTM/20190915/CRS3035RES50000m$name.tif" "$D/bev/$name.vrt"
  done < "$HERE/bev-dtm-tiles.txt"
  gdalbuildvrt -q "$D/bev.vrt" "$D"/bev/*.vrt ;;
tinitaly)
  # TINITALY 1.1 (INGV, CC BY 4.0, cite DOI 10.13127/tinitaly/1.1): 193 zipped 10 m tiles, 10.6 GB, read in place.
  mkdir -p "$D/tinitaly"
  curl -sSL -A $UA https://tinitaly.pi.ingv.it/Download_Area1_1.html |
    grep -oE 'data_1\.1/[a-z0-9_]+/[a-z0-9_]+\.zip' | sort -u |
    xargs -P 4 -I{} sh -c 'f="'"$D"'/tinitaly/$(basename {})"; [ -s "$f" ] || curl -sS --retry 3 -A '$UA' -o "$f" https://tinitaly.pi.ingv.it/{}'
  for f in "$D"/tinitaly/*.zip; do n=$(basename "$f" .zip); echo "/vsizip/$f/$n/$n.tif"; done > "$D/tinitaly_list.txt"
  gdalbuildvrt -q -input_file_list "$D/tinitaly_list.txt" "$D/tinitaly.vrt" ;;  # all tiles are EPSG:32632
glo30)
  # Copernicus GLO-30 fills everything outside the national models, read remotely. Edit the box as needed.
  curl -sS -A $UA https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt | tr -d '\r' |
    awk -F_ '{lat=substr($5,2)+0; lon=substr($7,2)+0; if (substr($5,1,1)=="N" && lat>=36 && lat<=49 && substr($7,1,1)=="E" && lon>=5 && lon<=18)
      print "/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/"$0"/"$0".tif"}' > "$D/glo_list.txt"
  GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR gdalbuildvrt -q -input_file_list "$D/glo_list.txt" "$D/glo.vrt" ;;
wikidata)
  # Wikidata prominence (P2660, metres) for items in CH, AT and IT, used only to check accuracy.
  Q='SELECT ?item ?prom WHERE { VALUES ?c { wd:Q39 wd:Q40 wd:Q38 } ?item wdt:P17 ?c; p:P2660/psv:P2660 [wikibase:quantityAmount ?prom; wikibase:quantityUnit ?u] . FILTER(?u = wd:Q11573) }'
  curl -sS -G https://query.wikidata.org/sparql --data-urlencode "query=$Q" -H 'Accept: text/csv' -A $UA |
    sed 's#http://www.wikidata.org/entity/##' > "$D/wd_prom.csv" ;;
*) echo "unknown source: $2" >&2; exit 1 ;;
esac
