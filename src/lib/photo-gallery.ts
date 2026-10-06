/** Shared presentation policy: docs/photo-viewer.md. */
export interface GalleryPhoto {
  unique_id: string;
  created_at: Date | null;
  urls: Record<string, string> | null;
  sizes: Record<string, [number, number]> | null;
}

export interface PhotoVariant {
  url: string;
  width?: number;
  height?: number;
}

export const scalarCompare = (a: string, b: string): number => {
  const left = Array.from(a, (c) => c.codePointAt(0)!);
  const right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length;
};

export function orderedPhotos<T extends GalleryPhoto>(photos: T[]): T[] {
  const time = (p: T) => {
    const value = p.created_at?.getTime();
    return value !== undefined && Number.isFinite(value) ? value : Infinity;
  };
  return [...photos].sort(
    (a, b) => time(a) - time(b) || scalarCompare(a.unique_id, b.unique_id),
  );
}

export function photoVariant(
  photo: Pick<GalleryPhoto, 'urls' | 'sizes'>,
  mode: 'thumbnail' | 'full',
): PhotoVariant | undefined {
  const variants = Object.entries(photo.urls ?? {})
    .flatMap(([key, raw]) => {
      let url: URL;
      try {
        url = new URL(raw.trim());
      } catch {
        return [];
      }
      if (!['https:', 'http:'].includes(url.protocol)) return [];
      const size = photo.sizes?.[key];
      const validSize =
        size?.length === 2 && size.every((n) => Number.isFinite(n) && n > 0);
      const numericKey = Number(key);
      const edge = validSize
        ? Math.max(...size)
        : Number.isFinite(numericKey) && numericKey > 0
          ? numericKey
          : Infinity;
      return [
        {
          key,
          edge,
          url: url.href,
          ...(validSize && { width: size[0], height: size[1] }),
        },
      ];
    })
    .sort((a, b) => a.edge - b.edge || scalarCompare(a.key, b.key));
  const known = variants.filter((v) => Number.isFinite(v.edge));
  const selected =
    mode === 'thumbnail'
      ? (known.find((v) => v.edge >= 256) ?? known.at(-1) ?? variants[0])
      : (known.filter((v) => v.edge <= 2048).at(-1) ?? known[0] ?? variants[0]);
  return selected;
}

export function validPhotoLocation(
  location: number[] | null | undefined,
): location is [number, number] {
  return (
    location?.length === 2 &&
    location.every(Number.isFinite) &&
    Math.abs(location[0]!) <= 90 &&
    Math.abs(location[1]!) <= 180
  );
}
