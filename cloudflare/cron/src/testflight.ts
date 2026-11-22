/**
 * Copies the crash reports TestFlight testers share from App Store Connect
 * into the D1 table defined in migrations/0001_testflight_crash_submissions.sql,
 * so they can be queried and analysed later. See docs/scheduled-jobs.md.
 */

/** The parts of Cloudflare's D1 binding this module uses. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

export interface AppStoreConnectCredentials {
  keyId: string;
  issuerId: string;
  /** Contents of the AuthKey_<id>.p8 file (PKCS #8 PEM). */
  privateKey: string;
}

export interface IngestOptions {
  db: D1Database;
  appId: string;
  credentials: AppStoreConnectCredentials;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Name of the app's binary image, used to pick the crashing app frame. */
  appImage?: string;
  /**
   * Caps that keep one run inside the Workers subrequest limit. The first run
   * reads at most pageSize * maxPages reports; later runs stop at the first
   * report they already have.
   */
  pageSize?: number;
  maxPages?: number;
  maxLogsPerRun?: number;
}

export interface IngestResult {
  listed: number;
  inserted: number;
  logsFetched: number;
  logsFailed: number;
}

const API = 'https://api.appstoreconnect.apple.com';
const MAX_LOG_ATTEMPTS = 5;

interface Resource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { data?: { id: string; type: string } | null }
  >;
}
interface ListResponse {
  data: Resource[];
  included?: Resource[];
  links?: { next?: string };
}

export async function ingestTestflightCrashes(
  options: IngestOptions,
): Promise<IngestResult> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const { db } = options;
  const token = await appStoreConnectToken(options.credentials, now());
  const get = (url: string) =>
    doFetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });

  const result: IngestResult = {
    listed: 0,
    inserted: 0,
    logsFetched: 0,
    logsFailed: 0,
  };

  // Newest first, so a run can stop at the first report it already has.
  const query = new URLSearchParams({
    sort: '-createdDate',
    limit: String(options.pageSize ?? 200),
    include: 'build',
    'fields[builds]': 'version',
  });
  let url: string | undefined =
    `${API}/v1/apps/${encodeURIComponent(options.appId)}/betaFeedbackCrashSubmissions?${query}`;
  for (let page = 0; url && page < (options.maxPages ?? 5); page++) {
    const response = await get(url);
    if (!response.ok) {
      throw new Error(
        `App Store Connect list: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    const body = (await response.json()) as ListResponse;
    result.listed += body.data.length;
    if (body.data.length === 0) break;

    const known = await knownIds(
      db,
      body.data.map((item) => item.id),
    );
    const builds = new Map(
      (body.included ?? [])
        .filter((item) => item.type === 'builds')
        .map((item) => [item.id, item.attributes?.version]),
    );
    const fresh = body.data.filter((item) => !known.has(item.id));
    if (fresh.length > 0) {
      const ingestedAt = now().toISOString();
      await db.batch(
        fresh.map((item) => insertSubmission(db, item, builds, ingestedAt)),
      );
      result.inserted += fresh.length;
    }
    if (known.size > 0) break;
    url = body.links?.next;
  }

  // Download the logs still missing, including earlier failures.
  const pending = await db
    .prepare(
      `SELECT id FROM crash_submissions
       WHERE crash_log IS NULL AND crash_log_attempts < ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(MAX_LOG_ATTEMPTS, options.maxLogsPerRun ?? 25)
    .all<{ id: string }>();
  for (const { id } of pending.results) {
    const response = await get(
      `${API}/v1/betaFeedbackCrashSubmissions/${encodeURIComponent(id)}/crashLog`,
    );
    const body = response.ok
      ? ((await response.json()) as { data?: Resource | null })
      : undefined;
    const logText = body?.data?.attributes?.logText;
    if (typeof logText === 'string' && logText.length > 0) {
      const { exceptionType, crashedFrame } = summarizeCrashLog(
        logText,
        options.appImage ?? 'ActivityMap',
      );
      await db
        .prepare(
          `UPDATE crash_submissions
           SET crash_log = ?, exception_type = ?, crashed_frame = ?,
               crash_log_attempts = crash_log_attempts + 1, crash_log_error = NULL
           WHERE id = ?`,
        )
        .bind(logText, exceptionType, crashedFrame, id)
        .run();
      result.logsFetched++;
      continue;
    }
    const error = response.ok
      ? 'App Store Connect returned no crash log'
      : `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
    await db
      .prepare(
        `UPDATE crash_submissions
         SET crash_log_attempts = crash_log_attempts + 1, crash_log_error = ?
         WHERE id = ?`,
      )
      .bind(error, id)
      .run();
    result.logsFailed++;
    // Rate limited: leave the rest for the next run.
    if (response.status === 429) break;
  }
  return result;
}

async function knownIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  const rows = await db
    .prepare(
      `SELECT id FROM crash_submissions WHERE id IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(...ids)
    .all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

function insertSubmission(
  db: D1Database,
  item: Resource,
  builds: Map<string, unknown>,
  ingestedAt: string,
): D1Statement {
  const attributes = item.attributes ?? {};
  const text = (key: string) =>
    typeof attributes[key] === 'string' ? attributes[key] : null;
  const buildId = item.relationships?.build?.data?.id ?? null;
  const buildNumber = buildId ? builds.get(buildId) : undefined;
  return db
    .prepare(
      `INSERT OR IGNORE INTO crash_submissions
       (id, created_at, build_id, build_number, app_platform, device_model,
        device_family, os_version, locale, comment, tester_email, attributes,
        ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      item.id,
      text('createdDate') ?? ingestedAt,
      buildId,
      typeof buildNumber === 'string' ? buildNumber : null,
      text('appPlatform'),
      text('deviceModel'),
      text('deviceFamily'),
      text('osVersion'),
      text('locale'),
      text('comment'),
      text('email'),
      JSON.stringify(attributes),
      ingestedAt,
    );
}

/**
 * Pulls the exception type and a frame to group by out of a crash log, in
 * either Apple's JSON (.ips) or text format. Either value is null when the
 * log doesn't have it; the full log is always kept.
 */
export function summarizeCrashLog(
  log: string,
  appImage: string,
): { exceptionType: string | null; crashedFrame: string | null } {
  const ips = parseIps(log);
  if (ips) return summarizeIps(ips, appImage);

  const exceptionType = /^Exception Type:\s*(.+?)\s*$/m.exec(log)?.[1] ?? null;
  const crashed = /^Thread \d+ Crashed:.*\n((?:\d+\s+.*(?:\n|$))+)/m.exec(log);
  const frames = (crashed?.[1] ?? '')
    .split('\n')
    .map((line) => /^\d+\s+(\S+)\s+0x[0-9a-f]+\s+(.*?)\s*$/i.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, image, rest]): Frame => {
      // Unsymbolicated: "<load address> + <offset>"; the address changes per launch.
      const raw = /^0x[0-9a-f]+ \+ (\d+)$/i.exec(rest!);
      return raw
        ? { image: image!, symbol: null, offset: raw[1]! }
        : { image: image!, symbol: rest!, offset: null };
    });
  return { exceptionType, crashedFrame: groupingFrame(frames, appImage) };
}

interface Frame {
  image: string;
  symbol: string | null;
  offset: string | null;
}

const MAX_FRAME_CHARS = 300;

/**
 * The crashed thread's most telling stable frame: a symbolicated app frame,
 * else the first symbolicated frame, else the first app frame by offset
 * (stable within one build), else the first frame.
 */
function groupingFrame(frames: Frame[], appImage: string): string | null {
  const frame =
    frames.find((f) => f.symbol && f.image === appImage) ??
    frames.find((f) => f.symbol) ??
    frames.find((f) => f.image === appImage) ??
    frames[0];
  if (!frame) return null;
  return `${frame.image} ${frame.symbol ?? `+${frame.offset ?? '?'}`}`.slice(
    0,
    MAX_FRAME_CHARS,
  );
}

interface IpsReport {
  exception?: { type?: string; signal?: string };
  faultingThread?: number;
  threads?: {
    triggered?: boolean;
    frames?: { imageIndex?: number; symbol?: string; imageOffset?: number }[];
  }[];
  usedImages?: { name?: string }[];
}

/** An .ips file is a one-line JSON header followed by the JSON report. */
function parseIps(log: string): IpsReport | null {
  const trimmed = log.trimStart();
  if (!trimmed.startsWith('{')) return null;
  const newline = trimmed.indexOf('\n');
  for (const candidate of [trimmed.slice(newline + 1), trimmed]) {
    try {
      const parsed = JSON.parse(candidate) as IpsReport;
      if (parsed.threads || parsed.exception) return parsed;
    } catch {
      // Try the next layout.
    }
  }
  return null;
}

function summarizeIps(report: IpsReport, appImage: string) {
  const { type, signal } = report.exception ?? {};
  const exceptionType = type ? (signal ? `${type} (${signal})` : type) : null;
  const thread =
    report.threads?.[report.faultingThread ?? -1] ??
    report.threads?.find((candidate) => candidate.triggered);
  const frames = (thread?.frames ?? []).map((frame): Frame => ({
    image: report.usedImages?.[frame.imageIndex ?? -1]?.name ?? '???',
    symbol: frame.symbol ?? null,
    offset: frame.imageOffset === undefined ? null : String(frame.imageOffset),
  }));
  return { exceptionType, crashedFrame: groupingFrame(frames, appImage) };
}

/** A 10-minute ES256 token for the App Store Connect API. */
export async function appStoreConnectToken(
  credentials: AppStoreConnectCredentials,
  now: Date,
): Promise<string> {
  const der = base64ToBytes(
    credentials.privateKey
      .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
      .replace(/\s+/g, ''),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const issuedAt = Math.floor(now.getTime() / 1000) - 10;
  const encode = (value: object) =>
    bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' })}.${encode(
    {
      iss: credentials.issuerId,
      iat: issuedAt,
      exp: issuedAt + 600,
      aud: 'appstoreconnect-v1',
    },
  )}`;
  // WebCrypto already returns the raw r || s form that JOSE expects.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
