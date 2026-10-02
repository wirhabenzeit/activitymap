// Capture the running local web app beside the native gallery:
// node --env-file=.env scripts/web-gallery.mjs <run-dir> [base-url]
//
// Requires `pnpm dev` (default http://localhost:3000) and the local Docker
// database. A temporary 30-minute session is created for the account with the
// most activities and removed afterwards. Captures use the iOS variant names so
// build-gallery-index.mjs can show both platforms side by side.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { chromium } from 'playwright-core';

const [runDir, baseURL = 'http://localhost:3000'] = process.argv.slice(2);
assert(runDir, 'Pass the gallery run directory');
const base = new URL(baseURL);
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Only a local web server is permitted');
const url = new URL(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '');
assert(['localhost', '127.0.0.1', 'db.localtest.me'].includes(url.hostname), 'Only the local Docker database is permitted');
url.hostname = '127.0.0.1';
assert(process.env.BETTER_AUTH_SECRET, 'BETTER_AUTH_SECRET is required to sign the temporary local session');

// Scene names match ScreenshotGalleryTests where the screens correspond.
const scenes = [
  { scene: 'map', title: 'Map', path: '/map', settle: 4000 },
  { scene: 'list', title: 'List', path: '/list', settle: 2000 },
  { scene: 'stats', title: 'Stats', path: '/stats/tiles', settle: 3000, fullPage: true },
];
const variants = [
  { variant: 'phone', width: 402, height: 874, dark: false, mobile: true },
  { variant: 'phone-dark', width: 402, height: 874, dark: true, mobile: true },
  { variant: 'tablet', width: 820, height: 1180, dark: false, mobile: true },
  { variant: 'desktop', width: 1440, height: 900, dark: false, mobile: false },
];

const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => undefined });
const id = `web-gallery-${randomUUID()}`;
const rawToken = randomBytes(32).toString('hex');
let browser;
try {
  const [user] = await sql`
    select u.id from "user" u
    where exists (select 1 from account a where a."userId" = u.id and a."providerId" = 'strava' and a.revoked_at is null)
    order by (select count(*) from activities a where a.athlete = u.athlete_id) desc limit 1`;
  assert(user, 'A local connected account is needed');
  await sql`insert into session (id, token, "userId", "expiresAt")
    values (${id}, ${rawToken}, ${user.id}, ${new Date(Date.now() + 30 * 60_000)})`;
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(rawToken).digest('base64');
  const cookie = { name: 'better-auth.session_token', value: encodeURIComponent(`${rawToken}.${signature}`),
    domain: base.hostname, path: '/', httpOnly: true, sameSite: 'Lax' };

  // A dev server compiles each route on first request; warm them before capturing.
  for (const s of scenes) {
    const target = new URL(s.path, base);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const status = await fetch(target, { headers: { cookie: `${cookie.name}=${cookie.value}` } })
        .then((r) => r.status).catch(() => 0);
      if (status > 0 && status < 500) break;
      assert(Date.now() < deadline, `${target} is not reachable; start the web dev server first`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  mkdirSync(runDir, { recursive: true });
  for (const v of variants) {
    const context = await browser.newContext({
      viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2, isMobile: v.mobile, hasTouch: v.mobile,
      colorScheme: v.dark ? 'dark' : 'light',
    });
    await context.addCookies([cookie]);
    const page = await context.newPage();
    for (const [order, s] of scenes.entries()) {
      await page.goto(new URL(s.path, base).toString(), { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(s.settle);
      const name = `web-${s.scene}--${v.variant}`;
      await page.screenshot({ path: join(runDir, `${name}.jpg`), type: 'jpeg', quality: 82, fullPage: !!s.fullPage });
      writeFileSync(join(runDir, `${name}.json`), JSON.stringify({
        platform: 'web', scene: s.scene, title: s.title, order, variant: v.variant,
        width: v.width, height: v.height, dark: v.dark, library: 'local database', basemap: 'mapbox',
      }, null, 2));
      console.log(`captured ${name}`);
    }
    await context.close();
  }
} finally {
  await browser?.close();
  await sql`delete from session where id = ${id} and token = ${rawToken}`;
  await sql.end({ timeout: 5 });
}
