// Most visited places (#461) in the real Stats dashboard against the shared
// place-ranking fixture: compact ranking, kind switch, coverage wording,
// shared place detail and its Show actions, the focus ranking, and narrow /
// enlarged layouts. Rankings come from synced bundles: no API requests.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve('esbuild', {
    paths: [dirname(require.resolve('tsx/package.json'))],
  }),
);
const temp = await mkdtemp(join(tmpdir(), 'place-ranking-'));
const output = join(root, 'output/quality/browser/place-ranking');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: join(temp, 'fixture.js'),
  alias: { '~': join(root, 'src') },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': '"development"',
    'process.env.NEXT_PUBLIC_ENV': '"development"',
    'process.env.NEXT_PUBLIC_MAPBOX_TOKEN': '"pk.synthetic"',
  },
  plugins: [
    {
      name: 'fixture-boundaries',
      setup(builder) {
        const stubs = {
          navigation: /^next\/navigation$/,
          dynamic: /^next\/dynamic$/,
          actions: /^~\/server\/strava\/actions$/,
          reads: /^~\/server\/db\/actions$/,
          snapshot: /use-library-snapshot$/,
        };
        for (const [path, filter] of Object.entries(stubs))
          builder.onResolve({ filter }, () => ({ path, namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          resolveDir: root,
          contents: {
            navigation: `export const useRouter=()=>({push:url=>{window.destination=url;},replace:()=>{}});export const usePathname=()=>'/stats';export const useSearchParams=()=>new URLSearchParams(location.search);`,
            dynamic: `export default function dynamic(){return function Unused(){return null;};}`,
            actions: `export function updateActivity(){throw Error('Unexpected external write');} export function deleteActivities(){throw Error('Unexpected external write');}`,
            reads: `export async function getPublicActivities(){throw Error('Unexpected guest read');} export async function getPublicUserActivities(){throw Error('Unexpected guest read');}`,
            snapshot: `import {useMemo} from 'react';import {useShallowStore} from '~/store';const refetch=async()=>{};export function useLibrarySnapshot(){const userId=useShallowStore(s=>s.user?.id);return useMemo(()=>({scope:'auth:'+userId,snapshot:{activities:window.fixtureDTOs,loaded:true,completeness:'complete',syncState:{placeMatchingVersion:window.fixtureVersion}},refetch}),[userId]);}`,
          }[args.path],
        }));
      },
    },
  ],
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import StatsTiles from '~/components/stats/tiles';
import {BrowsingProvider} from '~/hooks/use-browsing-library';
import {store} from '~/store';
import {activityDTOSchema} from '~/contracts/v1/activity';
import fixture from './shared/place-ranking-fixtures.v1.json';
import base from './shared/sync-integrity-fixtures.v1.json';
window.fixtureVersion=fixture.matchingVersion;
window.fixturePlaces=fixture.places;
window.fixtureDTOs=fixture.activities.map(row=>activityDTOSchema.parse({...base.activity,id:String(row.id),name:'Activity '+row.id,sport_type:row.sport_type,start_date_local:row.start_date_local,
  streams:{generation:'g1',revision:'1',state:'current',fetch_status:'succeeded',available_types:['distance','altitude','latlng'],fetched_at:null,expires_at:null},
  placeMatches:{userId:fixture.userId,activityId:String(row.id),status:row.status,streamGeneration:'g1',streamRevision:'1',catalogueSnapshotId:'catalogue',matcherVersion:'matcher',matchingVersion:fixture.matchingVersion,resultRevision:'result-'+row.id,
    places:row.places.map(({place,encounters})=>({...fixture.places[place],visits:Array.from({length:encounters},(_,i)=>({distanceM:10+i}))}))}}));
window.fixtureState=store;store.getState().initializeAuth({currentUser:{id:fixture.userId,stravaConnected:true}});
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><BrowsingProvider><main style={{height:'100vh'}}><StatsTiles/></main></BrowsingProvider></QueryClientProvider>);`,
  },
});
const postcss = require('postcss'),
  tailwind = require('@tailwindcss/postcss');
const cssFile = join(root, 'src/styles/globals.css');
const css = (
  await postcss([tailwind()]).process(await readFile(cssFile, 'utf8'), {
    from: cssFile,
  })
).css;
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(await readFile(join(temp, 'fixture.js')));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><html><head><style>' +
        css +
        '</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
    );
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined),
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
const errors = [],
  apiCalls = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname.startsWith('/api/'))
    apiCalls.push(request.url());
});
const fixture = JSON.parse(
  await readFile(join(root, 'shared/place-ranking-fixtures.v1.json'), 'utf8'),
);
const names = (rows) => rows.map(({ place }) => fixture.places[place].name);
const expected = Object.fromEntries(
  fixture.cases.map((row) => [row.name, row.expected]),
);
const thisYear = Object.values(expected)[1];
try {
  // The fixture's reporting day.
  await page.clock.setFixedTime(new Date(`${fixture.today}T12:00:00`));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const tile = page.locator('[data-tile-id="visitedPlaces"]');
  await tile.waitFor();
  const rowNames = (scope) =>
    scope
      .locator('ol > li')
      .evaluateAll((items) =>
        items.map(
          (item) =>
            item.querySelector('button, div')?.getAttribute('aria-label') ?? '',
        ),
      );
  const compact = await rowNames(tile);
  assert.deepEqual(
    compact.map((label) => label.replace(/^\d+\. /, '').split(',')[0]),
    names(thisYear.rows),
    'compact top five in shared order',
  );
  assert.match(compact[0], /^1\. Alpha Peak, 3,012 m, 3 activities\./);
  assert.match(compact[2], /^2\. Bravo Peak/, 'competition ranks for ties');
  await tile
    .getByText('May be incomplete: 3 of 9 activities have no completed')
    .waitFor();
  await tile.getByText('Top 5 of 6 peaks').waitFor();
  await page.screenshot({ path: join(output, 'dashboard-wide.png') });

  await tile.getByRole('button', { name: 'Huts' }).click();
  await tile.getByText('This year · routes passing nearby').waitFor();
  assert.deepEqual(
    (await rowNames(tile)).map((label) => label.split(',')[0]),
    ['1. Echo Hut'],
  );
  await tile.getByRole('button', { name: 'Passes' }).click();
  assert.deepEqual(
    (await rowNames(tile)).map((label) => label.split(',')[0]),
    ['1. Charlie', '2. Delta Pass'],
  );
  await tile.getByRole('button', { name: 'Peaks' }).click();

  // Inspection is separate from selection; Show activities filters.
  await tile.getByRole('button', { name: /^1\. Alpha Peak/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Alpha Peak').waitFor();
  await dialog.getByText('First visit').waitFor();
  assert.equal(
    await page.evaluate(() => window.fixtureState.getState().place),
    undefined,
    'opening the detail does not filter',
  );
  await dialog.getByRole('button', { name: 'Show activities' }).click();
  assert.equal(await page.evaluate(() => window.destination), '/list');
  assert.equal(
    await page.evaluate(() => window.fixtureState.getState().place?.id),
    fixture.places.alpha.id,
  );
  // With the place filter, the ranking lists the co-visited places.
  await page
    .getByText('Place: Alpha Peak', { exact: true })
    .waitFor({ timeout: 5000 });
  await page.evaluate(() => window.fixtureState.getState().resetFilters());

  await tile
    .getByRole('button', { name: 'Expand Most visited places' })
    .click();
  const focus = page.locator('[data-stats-focus="visitedPlaces"]');
  await focus.waitFor();
  await focus.getByText(/passing it several times on one route/).waitFor();
  assert.equal((await rowNames(focus)).length, thisYear.total);
  await focus.getByRole('button', { name: 'All time' }).click();
  const allTime = expected[fixture.cases[4].name];
  assert.deepEqual(
    (await rowNames(focus)).map(
      (label) => label.replace(/^\d+\. /, '').split(',')[0],
    ),
    names(allTime.rows),
  );
  await page.screenshot({ path: join(output, 'focus-all-time.png') });
  await focus.getByRole('button', { name: 'This year' }).click();
  await focus.getByRole('button', { name: 'Back to stats dashboard' }).click();
  await tile.waitFor({ state: 'visible' });

  // Completed empty versus pending.
  const onlySports = (sports) =>
    page.evaluate(
      (sports) =>
        window.fixtureState.setState((state) => {
          for (const type of Object.keys(state.sportType))
            state.sportType[type] = sports.includes(type);
        }),
      sports,
    );
  await onlySports(['Run']);
  await tile.getByText('No peaks on your routes this year.').waitFor();
  await onlySports(['Walk']);
  await tile
    .getByText(
      'No peaks found yet: 1 of 1 activity has no completed place check yet.',
    )
    .waitFor();
  await page.evaluate(() => window.fixtureState.getState().resetFilters());

  // Narrow and enlarged layouts stay inside the tile.
  const fits = () =>
    tile.evaluate((element) => ({
      overflow: element.scrollWidth - element.clientWidth,
      rows: element.querySelectorAll('ol > li').length,
      pageOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    }));
  for (const [width, zoom, name] of [
    [375, 1, 'phone'],
    [375, 2, 'phone-200-percent'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, zoom);
    await tile.scrollIntoViewIfNeeded();
    const layout = await fits();
    assert.ok(layout.overflow <= 0, `${name}: ${JSON.stringify(layout)}`);
    assert.ok(layout.pageOverflow <= 0, `${name}: ${JSON.stringify(layout)}`);
    assert.equal(layout.rows, 5, name);
    await tile.screenshot({ path: join(output, `${name}.png`) });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(apiCalls, [], 'rankings come from synced bundles');
  await writeFile(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        passed: [
          'compact shared order and ranks',
          'kind switch',
          'partial coverage disclosure',
          'shared detail and Show activities',
          'focus ranking and All time',
          'completed empty versus pending',
          'phone and 200% layouts',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Most visited places browser journeys passed; no API requests.');
} catch (error) {
  console.error({ errors, apiCalls });
  await page.screenshot({ path: join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
