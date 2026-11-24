import { open } from 'node:fs/promises';

/**
 * Downloads one Geofabrik file to a new local file. Geofabrik serves a
 * connection at one to two megabytes a second, so a large country takes most
 * of an hour and a dropped connection is likely: a download that stops is
 * resumed from the bytes already on disk instead of started again.
 */

export const DOWNLOAD_LIMITS = {
  /** The whole download, resumptions included. */
  totalMs: 2 * 60 * 60 * 1000,
  /** No answer, or no further bytes, for this long ends one connection. */
  stallMs: 60_000,
  /** Connections in a row that add no bytes before the download fails. */
  attemptsWithoutProgress: 5,
  /** The wait after the first such connection; it doubles each time. */
  retryMs: 2_000,
};

export type DownloadOptions = {
  fetcher?: typeof fetch;
  limits?: Partial<typeof DOWNLOAD_LIMITS>;
  onProgress?: (message: string) => void;
};

function geofabrikUrl(url: string | URL) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'download.geofabrik.de' ||
    parsed.port
  )
    throw new Error('Downloads require an HTTPS download.geofabrik.de URL');
  return parsed;
}

/** An answer that another connection will not change. */
class DownloadRefused extends Error {}

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(0)} MB`;

/**
 * Writes the file at `url` to `path`, which must not exist. Follows only
 * Geofabrik's own redirects. The file is complete when this returns: its
 * length is checked against the length Geofabrik announced.
 */
export async function downloadExtract(
  url: string,
  path: string,
  options: DownloadOptions = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const limits = { ...DOWNLOAD_LIMITS, ...options.limits };
  const deadline = AbortSignal.timeout(limits.totalMs);
  const file = await open(path, 'wx');
  try {
    // `-latest` redirects to the dated extract. Later connections ask for
    // the file the first one reached, so a resumption cannot continue with
    // another day's extract.
    let target = geofabrikUrl(url);
    let written = 0;
    let total: number | null = null;
    // Names the version of the file whose bytes are on disk.
    let validator: string | null = null;
    let idle = 0;
    for (;;) {
      const before = written;
      let failure: unknown;
      const stall = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const alive = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => stall.abort(new Error('The connection stalled')),
          limits.stallMs,
        );
      };
      const signal = AbortSignal.any([deadline, stall.signal]);
      try {
        alive();
        const headers: Record<string, string> = {};
        if (written > 0) {
          headers.Range = `bytes=${written}-`;
          if (validator) headers['If-Range'] = validator;
        }
        let response = await fetcher(target, {
          signal,
          redirect: 'manual',
          headers,
        });
        for (
          let hops = 0;
          response.status >= 300 && response.status < 400;
          hops++
        ) {
          const location = response.headers.get('location');
          if (!location || hops >= 3)
            throw new DownloadRefused(
              `Download redirect failed (${response.status})`,
            );
          const next = new URL(location, target);
          if (next.hostname !== 'download.geofabrik.de')
            throw new DownloadRefused(
              'Geofabrik redirected to a mirror; download its dated extract (-YYMMDD.osm.pbf) with --source-url',
            );
          target = geofabrikUrl(next);
          alive();
          response = await fetcher(target, {
            signal,
            redirect: 'manual',
            headers,
          });
        }
        if (response.status === 206) {
          const range = /^bytes (\d+)-\d+\/(\d+)$/.exec(
            response.headers.get('content-range') ?? '',
          );
          if (!range || Number(range[1]) !== written)
            throw new DownloadRefused(
              'Geofabrik answered a resumed download with another range',
            );
          if (total !== null && Number(range[2]) !== total)
            throw new DownloadRefused(
              'The file changed size during the download',
            );
          total = Number(range[2]);
        } else if (response.status === 200) {
          // The whole file: the first answer, or the file changed since
          // (`If-Range`) and the bytes on disk belong to the old one.
          if (written > 0) {
            await file.truncate(0);
            written = 0;
          }
          const length = response.headers.get('content-length');
          total = length === null ? null : Number(length);
          validator =
            response.headers.get('etag') ??
            response.headers.get('last-modified');
          // A weak validator cannot guard a range request.
          if (validator?.startsWith('W/')) validator = null;
        } else if (response.status >= 500 || response.status === 429) {
          throw new Error(`Download failed (${response.status})`);
        } else {
          throw new DownloadRefused(`Download failed (${response.status})`);
        }
        if (!response.body) throw new Error('Download has no body');
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            alive();
            await file.write(value, 0, value.length, written);
            written += value.length;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        // An answer without a length is complete when it ends.
        if (total === null || written === total) return written;
        if (written > total)
          throw new DownloadRefused('Geofabrik sent more bytes than announced');
        failure = new Error('The connection closed early');
      } catch (error) {
        if (error instanceof DownloadRefused) throw error;
        failure = error;
      } finally {
        clearTimeout(timer);
      }
      if (deadline.aborted)
        throw new Error(
          `Download exceeded ${Math.round(limits.totalMs / 60_000)} minutes at ${megabytes(written)}`,
          { cause: failure },
        );
      idle = written > before ? 0 : idle + 1;
      if (idle >= limits.attemptsWithoutProgress)
        throw new Error(
          `Download failed ${idle} times in a row at ${megabytes(written)}`,
          { cause: failure },
        );
      options.onProgress?.(
        `Download interrupted at ${megabytes(written)}${total === null ? '' : ` of ${megabytes(total)}`} (${failure instanceof Error ? failure.message : String(failure)}); resuming`,
      );
      if (idle > 0)
        await new Promise((done) =>
          setTimeout(done, limits.retryMs * 2 ** (idle - 1)),
        );
    }
  } finally {
    await file.close();
  }
}
