// Production React Query hooks, Mapbox layers and elevation UI, served locally
// with invented API responses. Real SQL/authorization is proved separately by
// db:test-on-demand-places; no credentials, raw tracks or outside services here.
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
const temp = await mkdtemp(join(tmpdir(), 'activity-places-web-'));
const output = resolve(
  process.argv[2] ?? join(root, 'output/quality/browser/activity-places'),
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
export const state=create(()=>({user:{id:'fixture',stravaConnected:true},isInitialized:true,isGuest:false,selected:[1],highlighted:1,visible:true,showProfile:true}));
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
import Map,{Source,Layer} from 'react-map-gl/mapbox';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ElevationChart} from '~/components/list/elevation-chart';import {MatchedPlacesLayer} from '~/components/map/matched-places-layer';
import {Selection} from '~/components/map/selection-control';import {useShallowStore} from '~/store';
import {encodeStreamSummary} from '~/lib/streams/compact-summary';import {streamSummaryQueryKey} from '~/lib/activity-stream-summary';
import {activityPlacesQueryRoot} from '~/lib/activity-places';
const metadata={generation:'g1',revision:'1',state:'current',fetch_status:'succeeded',available_types:['distance','altitude','latlng'],fetched_at:null,expires_at:null};
const latlng=[[47,8],[47.001,8.001],[47.002,8.002]];
const source={metadata,summary:encodeStreamSummary({version:2,basis:'distance',distance:[0,100,200],altitude:[400,500,420],latlng}),requestedAgainst:metadata,status:'ready',message:null,retryAt:null,pollStartedAt:0,pollAttempts:0};
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});window.client=client;
for(const user of ['fixture','other'])client.setQueryData(streamSummaryQueryKey(user,'1'),source);
const activities=new globalThis.Map([[1,{id:1,streamsMetadata:metadata}],[2,{id:2,streamsMetadata:metadata}]]);
window.refreshPlaces=()=>client.resetQueries({queryKey:['library','auth:'+window.fixtureState.getState().user.id,'activity-places']});
window.replaceProfile=()=>client.setQueryData(streamSummaryQueryKey('fixture','1'),{...source,metadata:{...metadata,revision:'2'}});
window.selectionCalls=0;
function App(){const s=useShallowStore(state=>state);const ids=s.visible?s.selected:[];return <QueryClientProvider client={client}>
<Map preserveDrawingBuffer={true} ref={ref=>{if(ref)window.fixtureMap=ref.getMap();}} onIdle={()=>window.mapReady=true} initialViewState={{longitude:8.001,latitude:47.001,zoom:14}} mapboxAccessToken="pk.offline-test" style={{height:260,width:'100%'}} mapStyle={{version:8,glyphs:window.location.origin+'/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9efea'}}]}}>
<Source id="routeSource" type="geojson" data={{type:'Feature',id:1,properties:{},geometry:{type:'LineString',coordinates:latlng.map(([lat,lng])=>[lng,lat])}}}><Layer id="routeLayerBG" type="line" paint={{'line-color':'#777','line-width':5}}/></Source>
<Selection onSelection={ids=>{window.selectionCalls++;window.fixtureState.setState({selected:ids});}}/>
<MatchedPlacesLayer activities={activities} selectedIds={ids} highlighted={s.highlighted}/></Map>
{s.showProfile&&s.selected.includes(1)&&<ElevationChart activityId="1" userId={s.user.id} streamMetadata={metadata}/>}
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
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{font:14px system-ui;margin:20px;background:hsl(var(--background));color:hsl(var(--foreground))}#root{max-width:600px}svg{display:block}section{margin-top:12px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
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
const requests = [],
  errors = [];
let owner = 'fixture',
  mode = 'complete',
  revision = '1';
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 680 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://**', (route) => route.abort());
  await page.route('**/api/activities/*/places', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    requests.push({ owner, id, mode });
    if (mode === 'error') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }
    await route.fulfill({
      json: {
        userId: owner,
        activityId: id,
        status: mode,
        streamGeneration: 'g1',
        streamRevision: revision,
        catalogueSnapshotId: 'fixture-catalogue',
        matcherVersion: 'fixture-matcher',
        places:
          mode === 'complete'
            ? [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  name:
                    owner === 'fixture'
                      ? 'Alpine test peak'
                      : 'Other account peak',
                  kinds: ['peak'],
                  longitude: 8.001,
                  latitude: 47.001,
                  elevationM: 500,
                  visits: [{ distanceM: 100 }, { distanceM: 180 }],
                },
              ]
            : [],
      },
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(
    () =>
      window.mapReady &&
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
        1,
  );
  assert.equal(await page.getByTestId('elevation-place-marker').count(), 2);
  assert.equal(
    requests.filter((request) => request.id === '1').length,
    1,
    'Map and profile share one in-flight request',
  );
  assert.equal(
    await page.getByRole('checkbox').count(),
    0,
    'No matching/debug checkboxes',
  );
  await page
    .getByRole('button', {
      name: 'Highlight Alpine test peak at 100 m',
      exact: true,
    })
    .focus();
  await page.keyboard.press('Enter');
  await page
    .locator('[data-map-place]')
    .getByText('Alpine test peak', { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', {
        name: 'Highlight Alpine test peak at 100 m',
        exact: true,
      })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.waitForFunction(
    () =>
      !window.fixtureMap.isMoving() &&
      window.fixtureMap.queryRenderedFeatures({
        layers: ['matched-places-points'],
      }).length === 1,
  );
  assert.equal(await page.locator('.mapboxgl-popup').count(), 1);
  await page.screenshot({ path: join(output, 'desktop.png') });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.setViewportSize({ width: 390, height: 720 });
  await page.waitForFunction(
    () =>
      window.fixtureMap.getCanvas().clientWidth ===
        window.fixtureMap.getContainer().clientWidth &&
      !window.fixtureMap.isMoving(),
  );
  assert.equal(
    await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(10, 10, 10)',
  );
  assert.equal(await page.locator('.mapboxgl-popup').count(), 1);
  assert.equal(
    await page
      .locator('.mapboxgl-popup-close-button')
      .evaluate((element) => getComputedStyle(element).color),
    'rgb(0, 0, 0)',
  );
  await page.screenshot({ path: join(output, 'mobile-dark.png') });
  assert(
    await page
      .locator('body')
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
    'No mobile horizontal overflow',
  );
  await page.setViewportSize({ width: 700, height: 680 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.evaluate(() => window.fixtureState.setState({ selected: [1, 2] }));
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      1,
  );
  await page
    .getByText('Matched on 2 selected routes', { exact: true })
    .waitFor();
  await page.evaluate(() => window.fixtureState.setState({ visible: false }));
  await page.waitForFunction(
    () => !window.fixtureMap.getSource('matched-places'),
  );
  await page.evaluate(() => window.fixtureState.setState({ visible: true }));
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      1,
  );
  await page.locator('.mapboxgl-popup-close-button').click();
  const pixel = await page.evaluate(() => {
    const p = window.fixtureMap.project([8.001, 47.001]);
    const r = window.fixtureMap.getCanvas().getBoundingClientRect();
    return { x: p.x + r.x, y: p.y + r.y };
  });
  await page.mouse.click(pixel.x, pixel.y);
  await page
    .getByText('Matched on 2 selected routes', { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.selectionCalls),
    0,
    'Place clicks do not alter route selection',
  );
  await page.evaluate(() => window.replaceProfile());
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="elevation-place-marker"]')
        .length === 0,
  );
  revision = '2';
  await page.evaluate(() => window.refreshPlaces());
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="elevation-place-marker"]')
        .length === 2,
  );
  mode = 'error';
  await page.evaluate(() => window.refreshPlaces());
  await page
    .getByText('Some places could not be loaded.', { exact: false })
    .waitFor();
  mode = 'complete';
  await page
    .locator('[data-map-place]')
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      1,
  );
  await page.evaluate(() => window.fixtureState.setState({ selected: [1] }));
  mode = 'uncovered';
  await page.evaluate(() => window.refreshPlaces());
  await page
    .getByText(
      'Places are currently available for routes within Switzerland, Austria and Italy.',
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.getByTestId('elevation-place-marker').count(), 0);
  mode = 'complete';
  owner = 'other';
  revision = '1';
  await page.evaluate(() =>
    window.fixtureState.setState({
      user: { id: 'other', stravaConnected: true },
    }),
  );
  await page
    .getByRole('button', {
      name: 'Highlight Other account peak at 100 m',
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: /Show Alpine test peak/ }).count(),
    0,
  );
  await page.evaluate(() => window.fixtureState.setState({ selected: [] }));
  await page.waitForFunction(
    () => !window.fixtureMap.getSource('matched-places'),
  );
  assert.equal(await page.getByTestId('elevation-place-marker').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        requests,
        checks: [
          'shared requests',
          'repeated profile positions',
          'keyboard place focus',
          'mobile/dark layout',
          'deduplicated multi-selection',
          'filter removal',
          'place click preserves selection',
          'stream revision fencing',
          'error/retry',
          'coverage state',
          'account isolation',
          'deselection',
        ],
        screenshots: ['desktop.png', 'mobile-dark.png'],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS web matching: actual Mapbox layers, profile annotations, shared requests, keyboard focus, multi-selection, filters, account isolation, stream replacement, retry and coverage states.',
  );
  console.log(`Evidence: ${output}`);
} finally {
  await browser.close();
  server.close();
}
