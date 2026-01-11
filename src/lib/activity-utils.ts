import type { Activity } from '~/server/db/schema';
import { type Feature, type Geometry } from 'geojson';
import { decode } from '@mapbox/polyline';

export const createFeature = (act: Activity): Feature<Geometry> => ({
    type: 'Feature',
    id: act.id,
    geometry: {
        type: 'LineString',
        coordinates:
            (act.map_polyline ?? act.map_summary_polyline)
                ? decode(act.map_summary_polyline! || act.map_polyline!).map(
                    ([lat, lon]) => [lon, lat],
                )
                : [],
    },
    properties: {
        id: act.id,
        sport_type: act.sport_type,
    },
    bbox:
        act.map_bbox?.length === 4
            ? (act.map_bbox as [number, number, number, number])
            : undefined,
});
