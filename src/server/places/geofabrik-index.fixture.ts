/** A small invented Geofabrik index (the real one has 554 extracts): two
 * neighbouring countries with parts and a composite, a country with a hole,
 * and a large country with parts and a special region. */
type Ring = [number, number][];
const box = (
  west: number,
  south: number,
  east: number,
  north: number,
): Ring => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

function feature(
  id: string,
  parent: string | null,
  path: string,
  rings: Ring[][],
  extra: Record<string, unknown> = {},
) {
  const name = path.split('/').at(-1)!;
  return {
    type: 'Feature',
    properties: {
      id,
      parent,
      name,
      urls: {
        pbf: `https://download.geofabrik.de/${path}/${name}-latest.osm.pbf`,
        poly: `https://download.geofabrik.de/${path}/${name}.poly`,
        taginfo: `https://taginfo.geofabrik.de/${path.replaceAll('/', ':')}`,
      },
      ...extra,
    },
    geometry: { type: 'MultiPolygon', coordinates: rings },
  };
}

export function geofabrikIndexFixture() {
  return {
    type: 'FeatureCollection',
    features: [
      feature('europe', null, 'europe', [[box(-10, 35, 30, 70)]], {
        special_regions: ['alps'],
      }),
      feature('alpland', 'europe', 'europe/alpland', [[box(7, 45, 10.1, 48)]], {
        'iso3166-1:alpha2': ['AL'],
      }),
      feature(
        'bergland',
        'europe',
        'europe/bergland',
        [[box(10.1, 45, 13, 48)]],
        {
          'iso3166-1:alpha2': ['BL'],
        },
      ),
      feature('alps', 'europe', 'europe/alps', [[box(7, 45, 13, 48)]]),
      feature('alpland-nord', 'alpland', 'europe/alpland/alpland-nord', [
        [box(7, 46.5, 10.1, 48)],
      ]),
      feature('alpland-sued', 'alpland', 'europe/alpland/alpland-sued', [
        [box(7, 45, 10.1, 46.5)],
      ]),
      feature(
        'ringland',
        'europe',
        'europe/ringland',
        [[box(20, 50, 24, 54), box(21, 51, 23, 53).reverse()]],
        { 'iso3166-1:alpha2': ['RL'] },
      ),
      feature('north-america', null, 'north-america', [
        [box(-170, 10, -50, 80)],
      ]),
      feature(
        'bigland',
        'north-america',
        'north-america/bigland',
        [[box(-120, 30, -100, 45)]],
        { 'iso3166-1:alpha2': ['BG'], special_regions: ['bigland-coast'] },
      ),
      feature(
        'bigland/west',
        'bigland',
        'north-america/bigland/west',
        [[box(-120, 30, -110, 45)]],
        { 'iso3166-2': ['BG-W'] },
      ),
      feature(
        'bigland/east',
        'bigland',
        'north-america/bigland/east',
        [[box(-110, 30, -100, 45)]],
        { 'iso3166-2': ['BG-E'] },
      ),
      feature('bigland-coast', 'bigland', 'north-america/bigland-coast', [
        [box(-120, 30, -115, 45)],
      ]),
    ],
  };
}
