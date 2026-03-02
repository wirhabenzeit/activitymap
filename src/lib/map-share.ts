import { type ViewState } from 'react-map-gl/mapbox';

import { baseMaps, defaultMapPosition, overlayMaps } from '~/settings/map';

type SearchParamsLike = Pick<URLSearchParams, 'get' | 'has'>;

type SharedViewState = Pick<
  ViewState,
  'longitude' | 'latitude' | 'zoom' | 'bearing' | 'pitch' | 'padding'
>;

export type SharedMapStateSnapshot = {
  baseMap: keyof typeof baseMaps;
  overlayMaps: (keyof typeof overlayMaps)[];
  position: SharedViewState;
  threeDim: boolean;
  showPhotos: boolean;
};

export type SharedMapStatePatch = Partial<SharedMapStateSnapshot>;

export type ParsedMapShareState = {
  hasAnyMapParam: boolean;
  hasPositionRequest: boolean;
  patch: SharedMapStatePatch;
};

const parseNumber = (
  value: string | null,
  { min, max }: { min: number; max: number },
): number | undefined => {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
};

const parseBoolean = (value: string | null): boolean | undefined => {
  if (value === null) {
    return undefined;
  }
  if (value === '1' || value.toLowerCase() === 'true') {
    return true;
  }
  if (value === '0' || value.toLowerCase() === 'false') {
    return false;
  }
  return undefined;
};

const isBaseMapId = (value: string): value is keyof typeof baseMaps => {
  return value in baseMaps;
};

const isOverlayMapId = (value: string): value is keyof typeof overlayMaps => {
  return value in overlayMaps;
};

export const appendMapShareParams = (
  url: URL,
  state: SharedMapStateSnapshot,
): void => {
  url.searchParams.set('mbase', state.baseMap);
  url.searchParams.set('mol', state.overlayMaps.join(','));
  url.searchParams.set('mlng', state.position.longitude.toFixed(5));
  url.searchParams.set('mlat', state.position.latitude.toFixed(5));
  url.searchParams.set('mz', state.position.zoom.toFixed(2));
  url.searchParams.set('mbearing', state.position.bearing.toFixed(1));
  url.searchParams.set('mpitch', state.position.pitch.toFixed(1));
  url.searchParams.set('m3d', state.threeDim ? '1' : '0');
  url.searchParams.set('mph', state.showPhotos ? '1' : '0');
};

export const parseMapShareParams = (
  searchParams: SearchParamsLike,
): ParsedMapShareState => {
  const hasAnyMapParam =
    searchParams.has('mbase') ||
    searchParams.has('mol') ||
    searchParams.has('mlng') ||
    searchParams.has('mlat') ||
    searchParams.has('mz') ||
    searchParams.has('mbearing') ||
    searchParams.has('mpitch') ||
    searchParams.has('m3d') ||
    searchParams.has('mph');

  const hasPositionRequest =
    searchParams.has('mlng') ||
    searchParams.has('mlat') ||
    searchParams.has('mz') ||
    searchParams.has('mbearing') ||
    searchParams.has('mpitch');

  const patch: SharedMapStatePatch = {};

  const baseMap = searchParams.get('mbase');
  if (baseMap && isBaseMapId(baseMap)) {
    patch.baseMap = baseMap;
  }

  if (searchParams.has('mol')) {
    const overlayRaw = searchParams.get('mol') ?? '';
    const overlays = overlayRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry): entry is keyof typeof overlayMaps => {
        return entry.length > 0 && isOverlayMapId(entry);
      });
    patch.overlayMaps = overlays;
  }

  const longitude = parseNumber(searchParams.get('mlng'), {
    min: -180,
    max: 180,
  });
  const latitude = parseNumber(searchParams.get('mlat'), {
    min: -90,
    max: 90,
  });
  const zoom = parseNumber(searchParams.get('mz'), {
    min: 0,
    max: 24,
  });
  const bearing =
    parseNumber(searchParams.get('mbearing'), {
      min: -360,
      max: 360,
    }) ?? defaultMapPosition.bearing;
  const pitch =
    parseNumber(searchParams.get('mpitch'), {
      min: 0,
      max: 85,
    }) ?? defaultMapPosition.pitch;

  if (
    longitude !== undefined &&
    latitude !== undefined &&
    zoom !== undefined
  ) {
    patch.position = {
      longitude,
      latitude,
      zoom,
      bearing,
      pitch,
      padding: defaultMapPosition.padding,
    };
  }

  const threeDim = parseBoolean(searchParams.get('m3d'));
  if (threeDim !== undefined) {
    patch.threeDim = threeDim;
  }

  const showPhotos = parseBoolean(searchParams.get('mph'));
  if (showPhotos !== undefined) {
    patch.showPhotos = showPhotos;
  }

  return {
    hasAnyMapParam,
    hasPositionRequest,
    patch,
  };
};
