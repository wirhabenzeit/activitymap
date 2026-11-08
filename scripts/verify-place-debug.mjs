// Production debug toggle and map UI with synthetic API responses.
// Real SQL, ownership and no-write guarantees are checked by db:test-on-demand-places.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve('esbuild', {
    paths: [dirname(require.resolve('tsx/package.json'))],
  }),
);
const postcss = require('postcss'),
  tailwind = require('@tailwindcss/postcss');
const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'place-debug-web-'));
const output = resolve(
  process.argv[2] ?? join(root, 'output/quality/browser/place-debug'),
);
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: join(temp, 'fixture.js'),
  alias: { '~': join(root, 'src') },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'fixture-auth',
      setup(builder) {
        builder.onResolve({ filter: /^~\/store$/ }, () => ({
          path: 'store',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          resolveDir: root,
          contents: `
import {create} from 'zustand';import {useShallow} from 'zustand/shallow';
export const state=create(()=>({user:{id:'fixture',stravaConnected:true},authSession:1,isInitialized:true,isGuest:false,selected:[1],highlighted:1}));
export const useShallowStore=selector=>state(useShallow(selector));window.fixtureState=state;
`,
        }));
      },
    },
  ],
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import Map from 'react-map-gl/mapbox';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ActivityPlacesLayers} from '~/components/map/activity-places-layers';
import {PlaceDebugSettings} from '~/components/settings/place-debug-settings';
import {usePlaceDebug} from '~/store/place-debug';import {useShallowStore} from '~/store';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
const activities=new globalThis.Map([[1,{id:1,name:'Test hike',streamsMetadata:{generation:'g1',revision:'1'}}],[2,{id:2,name:'Second hike'}]]);
window.debugStore=usePlaceDebug;
function App(){const s=useShallowStore(state=>state);return <QueryClientProvider client={client}>
<div style={{padding:12}}><PlaceDebugSettings check={true}/></div>
<Map preserveDrawingBuffer={true} initialViewState={{longitude:8.003,latitude:47.001,zoom:14}} mapboxAccessToken="pk.offline-test" style={{height:650,width:'100%'}} mapStyle={{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9efea'}}]}}>
<ActivityPlacesLayers activities={activities} selectedIds={s.selected} highlighted={s.highlighted}/></Map>
</QueryClientProvider>;}createRoot(document.getElementById('root')).render(<App/>);

`,
  },
});
const css = join(root, 'src/styles/globals.css');
await writeFile(
  join(temp, 'app.css'),
  (
    await postcss([tailwind()]).process(await readFile(css, 'utf8'), {
      from: css,
    })
  ).css,
);
await writeFile(
  join(temp, 'index.html'),
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{font:14px system-ui;margin:20px;background:hsl(var(--background));color:hsl(var(--foreground))}#root{width:100%}svg{display:block}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/fonts/')) {
    res.setHeader('Content-Type', 'application/x-protobuf');
    res.end();
    return;
  }
  const file = req.url === '/' ? 'index.html' : req.url?.slice(1);
  if (!['index.html', 'fixture.js', 'app.css'].includes(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    'Content-Type',
    file.endsWith('.js')
      ? 'application/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html',
  );
  res.end(await readFile(join(temp, file)));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined),
});
const errors = [];
let allowed = false;
let owner = 'fixture';
let mode = 'complete';
const requests = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
try {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://**', (route) => route.abort());
  await page.route('**/api/debug/places', (route) =>
    route.fulfill({ json: { userId: owner, allowed } }),
  );
  await page.route('**/api/activities/*/places', (route) =>
    route.fulfill({
      json: {
        userId: owner,
        activityId: '1',
        status: 'complete',
        streamGeneration: 'g1',
        streamRevision: '1',
        catalogueSnapshotId: 'test',
        matcherVersion: 'test',
        places: [],
      },
    }),
  );
  await page.route('**/api/activities/*/places/debug', (route) => {
    const settings = route.request().postDataJSON();
    const id = new URL(route.request().url()).pathname.split('/')[3];
    requests.push({ settings, id });
    if (mode === 'error') return route.fulfill({ status: 503, json: {} });
    if (mode === 'denied') return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      json: {
        userId: owner,
        activityId: id,
        status: mode,
        streamGeneration: 'g1',
        streamRevision: '1',
        catalogueSnapshotId: 'test',
        matcherVersion: 'test',
        settings,
        reasons: mode === 'partial' ? ['candidate_limit'] : [],
        candidates: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Nearby test peak',
            kinds: ['peak'],
            longitude: 8.005,
            latitude: 47.001,
            elevationM: 500,
            status:
              mode === 'partial'
                ? 'uncertain'
                : settings.peakRadiusM >= 95
                  ? 'matched'
                  : 'rejected',
            defaultMatched: mode === 'partial' ? null : false,
            distanceM: 90,
            altitudeDifferenceM: 20,
            peakMatch: {
              score: Math.hypot(
                90 / settings.peakRadiusM,
                20 / settings.peakVerticalToleranceM,
              ),
              horizontalDistanceM: 90,
              recordedElevationM: 520,
              altitudeDifferenceM: 20,
              spatialDistanceM: 92.2,
              usesElevation: true,
              reliable: true,
            },
            reasons: ['outside_relation_radius'],
          },
          {
            id: '00000000-0000-4000-8000-000000000002',
            name: 'Outside entry peak',
            kinds: ['peak'],
            longitude: 8.008,
            latitude: 47.002,
            elevationM: 600,
            status: mode === 'partial' ? 'uncertain' : 'rejected',
            defaultMatched: mode === 'partial' ? null : false,
            distanceM: 200,
            altitudeDifferenceM: null,
            reasons: ['outside_entry_radius'],
          },
        ],
      },
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => document.querySelector('canvas'));
  assert.equal(
    await page.getByRole('switch').count(),
    0,
    'Non-allowlisted users never see the toggle',
  );
  assert.equal(requests.length, 0);
  allowed = true;
  await page.reload();
  await page.getByRole('switch', { name: 'Place matching debug mode' }).check();
  await page
    .getByRole('region', { name: 'Place matching debug', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Nearby test peak: rejected', exact: true })
    .waitFor();
  await page.getByText('Weighted peak score', { exact: true }).waitFor();
  await page
    .getByRole('list', { name: 'Nearby places' })
    .getByText('Score 1.280', { exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Nearby test peak: rejected', exact: true })
    .click();
  await page.getByText('Outside the match radius', { exact: true }).waitFor();
  await page
    .getByText('Weighted score: 1.280 (≤ 1 passes)', { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, 'rejection-reason.png') });
  await page
    .getByRole('button', { name: 'Place matching debug', exact: true })
    .click();
  await page
    .getByText('Candidate search and encounter grouping', { exact: true })
    .click();
  await page
    .getByLabel('Encounter entry (m)', { exact: true })
    .waitFor({ state: 'visible' });
  await page
    .getByText('Candidate search and encounter grouping', { exact: true })
    .click();
  await page.getByLabel('Horizontal tolerance (m)', { exact: true }).fill('95');
  const beforeApply = requests.length;
  assert.equal(requests.at(-1).settings.peakRadiusM, 72);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page
    .getByRole('button', { name: 'Nearby test peak: matched', exact: true })
    .waitFor();
  assert.equal(requests.length, beforeApply + 1);
  assert.equal(requests.at(-1).settings.peakRadiusM, 95);
  await page
    .getByLabel('Horizontal tolerance (m)', { exact: true })
    .fill('1000');
  assert(
    await page.getByRole('button', { name: 'Apply', exact: true }).isDisabled(),
  );
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page
    .getByRole('button', { name: 'Nearby test peak: rejected', exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, 'desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'phone.png') });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page
    .getByRole('list', { name: 'Nearby places' })
    .getByRole('button')
    .first()
    .click();
  await page.getByText('Outside the match radius', { exact: true }).waitFor();
  await page
    .getByText('Weighted score: 1.280 (≤ 1 passes)', { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, 'phone-rejection-reason.png') });
  await page
    .getByRole('button', { name: 'Place matching debug', exact: true })
    .click();
  mode = 'partial';
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page
    .getByText('Incomplete check — results are not conclusive.', {
      exact: true,
    })
    .waitFor();
  await page
    .getByText('Candidate limit reached; some nearby places are omitted', {
      exact: true,
    })
    .waitFor();
  mode = 'error';
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Nearby test peak: uncertain', exact: true })
      .count(),
    0,
  );
  mode = 'complete';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page
    .getByRole('button', { name: 'Nearby test peak: rejected', exact: true })
    .waitFor();
  // Changing accounts removes the active experiment even before the access request returns.
  owner = 'other';
  await page.evaluate(() =>
    window.fixtureState.setState({
      user: { id: 'other', stravaConnected: true },
      authSession: 2,
    }),
  );
  await page
    .getByRole('region', { name: 'Place matching debug', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(
    await page
      .getByRole('button', { name: 'Nearby test peak: rejected', exact: true })
      .count(),
    0,
  );
  await page.getByRole('switch').check();
  await page
    .getByRole('region', { name: 'Place matching debug', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Nearby test peak: rejected', exact: true })
    .waitFor();
  mode = 'denied';
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page
    .getByRole('region', { name: 'Place matching debug', exact: true })
    .waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      { passed: true, requests: requests.length, errors },
      null,
      2,
    ),
  );
  console.log(`Place debug browser checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
