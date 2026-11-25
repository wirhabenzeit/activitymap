"""List swissALTI3D 2 m tile URLs from the swisstopo STAC API.

usage: python3 -I swissalti3d-list.py <out.tsv>
Writes one "item id<TAB>url" line per tile and year; keep the latest year per tile afterwards.
"""
import json
import sys
import urllib.request

url = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?limit=100'
out = open(sys.argv[1], 'w')
n = 0
while url:
    request = urllib.request.Request(url, headers={'User-Agent': 'prominence-trial'})
    with urllib.request.urlopen(request, timeout=60) as response:
        page = json.load(response)
    for feature in page['features']:
        for key, asset in feature['assets'].items():
            if key.endswith('_2_2056_5728.tif'):
                out.write(f"{feature['id']}\t{asset['href']}\n")
                n += 1
    url = next((link['href'] for link in page.get('links', []) if link.get('rel') == 'next'), None)
print(n)
