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
import {create} from 'zustand';import {useShallow} from 'zustand/shallow';import {immer} from 'zustand/middleware/immer';
import {createSelectionSlice} from '~/store/selection';
export const state=create(immer((...args)=>({...createSelectionSlice(...args),user:{id:'fixture',stravaConnected:true},isInitialized:true,isGuest:false,selected:[1],highlighted:1,visible:true,showProfile:true})));
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
import {placeSymbolImage} from '~/lib/place-symbols';window.fixturePlaceImage=placeSymbolImage;
import {applyV1SyncPage,getV1SyncState} from '~/lib/sync/v1-store';
import {getLibraryOwner} from '~/lib/sync/library-owner';
import {resetActivityPlaceFocus} from '~/store/activity-place-focus';window.clearPlaceFocus=resetActivityPlaceFocus;
import fixtureDTOs from './shared/sync-integrity-fixtures.v1.json';
const metadata={generation:'g1',revision:'1',state:'current',fetch_status:'succeeded',available_types:['distance','altitude','latlng'],fetched_at:null,expires_at:null};
const latlng=[[47,8],[47.001,8.001],[47.002,8.002]];
const source={metadata,summary:encodeStreamSummary({version:2,basis:'distance',distance:[0,100,200],altitude:[400,500,420],latlng}),requestedAgainst:metadata,status:'ready',message:null,retryAt:null,pollStartedAt:0,pollAttempts:0};
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});window.client=client;
for(const user of ['fixture','other'])client.setQueryData(streamSummaryQueryKey(user,'1'),source);
const activities=new globalThis.Map([[1,{id:1,streamsMetadata:metadata}],[2,{id:2,streamsMetadata:metadata}]]);
window.refreshPlaces=()=>client.resetQueries({queryKey:['library','auth:'+window.fixtureState.getState().user.id,'activity-places']});
window.replaceProfile=()=>client.setQueryData(streamSummaryQueryKey('fixture','1'),{...source,metadata:{...metadata,revision:'2'}});
window.saveSyncedPlaces=async(bundle,version)=>{
 const scope='auth:fixture';const state={scope,bootstrapCursor:'snapshot',bootstrapComplete:true,changesCursor:bundle?.resultRevision??'version',lastSyncAt:new Date().toISOString(),updatedAt:new Date().toISOString(),placeMatchingVersion:version,placesSyncReady:true};
 const mutations=bundle?[{sequence:'1',entityType:'activity',operation:'upsert',id:bundle.activityId,activity:{...fixtureDTOs.activity,id:bundle.activityId,streams:metadata,placeMatches:bundle}}]:[];
 await applyV1SyncPage(scope,mutations,state);await getLibraryOwner(client,scope).load();
};
window.restoreProfile=()=>client.setQueryData(streamSummaryQueryKey('fixture','1'),source);
window.selectionCalls=0;
window.placePicks=[];
function App(){const s=useShallowStore(state=>state);const ids=s.visible?s.selected:[];return <QueryClientProvider client={client}>
<Map preserveDrawingBuffer={true} ref={ref=>{if(ref)window.fixtureMap=ref.getMap();}} onIdle={()=>window.mapReady=true} initialViewState={{longitude:8.001,latitude:47.001,zoom:14}} mapboxAccessToken="pk.offline-test" style={{height:260,width:'100%'}} mapStyle={{version:8,glyphs:window.location.origin+'/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9efea'}}]}}>
<Source id="routeSource" type="geojson" data={{type:'Feature',id:1,properties:{},geometry:{type:'LineString',coordinates:latlng.map(([lat,lng])=>[lng,lat])}}}><Layer id="routeLayerBG" type="line" paint={{'line-color':'#777','line-width':5}}/></Source>
<Selection onSelection={ids=>{window.selectionCalls++;window.fixtureState.getState().pickActivities(ids);}}/>
<MatchedPlacesLayer activities={activities} selectedIds={ids} visibleIds={s.visibleIDs??ids} showAllPlaces={s.showAllPlaces??false} inspectedActivityId={s.inspectedActivityId} highlighted={s.highlighted}
onPickActivities={ids=>{window.placePicks.push(ids);window.fixtureState.getState().pickActivities(ids);window.fixtureState.setState({inspectedActivityId:ids.length===1?ids[0]:undefined});}}/></Map>
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
let page;
let owner = 'fixture',
  mode = 'complete',
  revision = '1',
  matchingVersion = 'a'.repeat(64),
  holdResponse = false,
  releaseResponse;
try {
  page = await browser.newPage({ viewport: { width: 700, height: 680 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://**', (route) => route.abort());
  await page.route('**/api/places/version', (route) =>
    route.fulfill({ json: { version: matchingVersion } }),
  );
  await page.route('**/api/activities/*/places', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    requests.push({ owner, id, mode });
    if (holdResponse)
      await new Promise((resolve) => {
        releaseResponse = resolve;
      });
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
        matchingVersion,
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
                {
                  id: '00000000-0000-4000-8000-000000000002',
                  name: 'Alpine test pass',
                  kinds: ['pass'],
                  longitude: 8.0004,
                  latitude: 47.0004,
                  elevationM: 450,
                  visits: [{ distanceM: 40 }],
                },
                {
                  id: '00000000-0000-4000-8000-000000000003',
                  name: 'Alpine test hut',
                  kinds: ['hut'],
                  longitude: 8.0015,
                  latitude: 47.0015,
                  elevationM: 440,
                  visits: [{ distanceM: 150 }, { distanceM: 220 }],
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
        3,
  );
  assert.equal(await page.getByTestId('elevation-place-marker').count(), 5);
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
  assert.equal(
    await page.getByText('Places along this route').count(),
    0,
    'No duplicate place list',
  );
  assert.deepEqual(
    await page
      .getByTestId('elevation-place-marker')
      .evaluateAll((nodes) =>
        [...new Set(nodes.map((node) => node.dataset.placeKind))].sort(),
      ),
    ['hut', 'pass', 'peak'],
  );
  assert.equal(
    await page.getByRole('slider').getByRole('button').count(),
    0,
    'Place buttons are separate from the chart slider',
  );
  const endpoint = page.getByRole('button', {
    name: 'Highlight Alpine test hut at 200 m',
    exact: true,
  });
  await endpoint.waitFor();
  const endpointCircle = await endpoint.locator('span').boundingBox();
  const profileBounds = await page
    .getByRole('region', { name: 'Elevation profile', exact: true })
    .boundingBox();
  assert(
    endpointCircle.x >= profileBounds.x &&
      endpointCircle.x + endpointCircle.width <=
        profileBounds.x + profileBounds.width,
    'Endpoint circle stays fully visible',
  );
  assert.equal(await page.getByTestId('elevation-place-guide').count(), 5);
  const beforeReopen = requests.length;
  await page.evaluate(() =>
    window.fixtureState.setState({ showProfile: false }),
  );
  await page.getByRole('slider').waitFor({ state: 'detached' });
  await page.evaluate(() =>
    window.fixtureState.setState({ showProfile: true }),
  );
  await page.getByRole('slider').waitFor();
  await page.waitForFunction(() => window.client.isFetching() === 0);
  assert.equal(
    requests.length,
    beforeReopen,
    'Reopening a current profile reuses cached matching',
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
      }).length === 3,
  );
  assert.equal(await page.locator('.mapboxgl-popup').count(), 1);
  const symbols = await page.evaluate(() =>
    window.fixtureMap
      .getSource('matched-places')
      ._data.features.map((feature) => feature.properties.icon),
  );
  assert.equal(
    new Set(symbols).size,
    3,
    'Distinct map sprites for peak, pass and hut',
  );
  assert(
    await page.evaluate(() =>
      ['peak', 'pass', 'hut'].every((kind) =>
        window.fixtureMap.hasImage('matched-place-' + kind),
      ),
    ),
    'All place sprites loaded',
  );
  await page
    .getByRole('button', {
      name: 'Highlight Alpine test peak at 100 m',
      exact: true,
    })
    .click();
  await page.mouse.move(650, 600);
  await page.screenshot({ path: join(output, 'desktop.png') });
  const selectedCircle = page
    .getByRole('button', {
      name: 'Highlight Alpine test peak at 100 m',
      exact: true,
    })
    .locator('span');
  assert.equal(
    await selectedCircle.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    ),
    await page
      .locator(
        '[data-testid="elevation-plot-area"] path[stroke="var(--activity-accent)"]',
      )
      .evaluate((node) => getComputedStyle(node).stroke),
    'Selected place matches the profile colour',
  );
  const spriteColour = await page.evaluate(() => {
    const sprite = window.fixturePlaceImage('peak', true);
    const offset = (16 * sprite.width + 32) * 4;
    return 'rgb(' + [...sprite.data.slice(offset, offset + 3)].join(', ') + ')';
  });
  assert.equal(
    spriteColour,
    await selectedCircle.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    ),
    'Map selection matches the profile colour',
  );
  const card = await page
    .locator('.matched-place-popup [data-map-place]')
    .boundingBox();
  assert(
    card.width <= 220 && card.height <= 60,
    'Map place callout remains compact',
  );
  await page.evaluate(() => document.activeElement?.blur());
  await page
    .getByRole('region', { name: 'Elevation profile', exact: true })
    .screenshot({ path: join(output, 'elevation-light.png') });
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
      .getByRole('button', { name: 'Close place', exact: true })
      .evaluate((element) => getComputedStyle(element).color),
    'rgb(163, 163, 163)',
  );
  const darkSpriteColour = await page.evaluate(() => {
    const sprite = window.fixturePlaceImage('peak', true);
    const offset = (16 * sprite.width + 32) * 4;
    return 'rgb(' + [...sprite.data.slice(offset, offset + 3)].join(', ') + ')';
  });
  assert.equal(
    darkSpriteColour,
    await selectedCircle.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    ),
    'Map selection matches the profile in dark mode',
  );
  await page.screenshot({ path: join(output, 'mobile-dark.png') });
  await page
    .getByRole('region', { name: 'Elevation profile', exact: true })
    .screenshot({ path: join(output, 'elevation-dark.png') });
  await page.getByTestId('elevation-place-readout').waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Clear highlighted place', exact: true })
      .count(),
    0,
    'Place readout has no close button',
  );
  const readoutColour = await page
    .getByTestId('elevation-place-readout')
    .evaluate((node) => getComputedStyle(node).color);
  assert.equal(
    readoutColour,
    await page
      .getByRole('button', {
        name: 'Highlight Alpine test peak at 100 m',
        exact: true,
      })
      .locator('span')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    'Readout matches selected marker blue',
  );
  const surface = await page.getByRole('slider').boundingBox();
  const scrubY = surface.y + surface.height - 8;
  const scrubX = surface.x + surface.width * 0.4;
  await page.mouse.move(scrubX, scrubY);
  await page.mouse.down();
  await page.mouse.move(surface.x + surface.width * 0.7, scrubY, { steps: 8 });
  await page.mouse.move(scrubX, scrubY, { steps: 8 });
  await page.mouse.up();
  assert.equal(
    await page.locator('.mapboxgl-popup').count(),
    1,
    'Scrubbing out and back does not dismiss the place',
  );
  await page
    .getByRole('slider')
    .click({ position: { x: 100, y: surface.height - 8 } });
  assert.equal(
    await page.locator('.mapboxgl-popup').count(),
    0,
    'A chart tap dismisses the place and its map card',
  );
  await page
    .getByRole('button', {
      name: 'Highlight Alpine test peak at 100 m',
      exact: true,
    })
    .click();
  await page.keyboard.press('Escape');
  assert.equal(
    await page.locator('.mapboxgl-popup').count(),
    0,
    'Escape dismisses a place',
  );
  await page
    .getByRole('button', {
      name: 'Highlight Alpine test peak at 100 m',
      exact: true,
    })
    .click();

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
      3,
  );
  await page.getByText('2 selected routes', { exact: true }).waitFor();
  await page.evaluate(() => window.fixtureState.setState({ visible: false }));
  await page.waitForFunction(
    () => !window.fixtureMap.getSource('matched-places'),
  );
  await page.evaluate(() => window.fixtureState.setState({ visible: true }));
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      3,
  );
  await page.getByRole('button', { name: 'Close place', exact: true }).click();
  const pixel = await page.evaluate(() => {
    const p = window.fixtureMap.project([8.001, 47.001]);
    const r = window.fixtureMap.getCanvas().getBoundingClientRect();
    return { x: p.x + r.x, y: p.y + r.y };
  });
  await page.mouse.click(pixel.x, pixel.y);
  await page.getByText('2 selected routes', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.selectionCalls),
    0,
    'Place clicks do not alter route selection',
  );
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Map style replacement timed out')),
          10000,
        );
        window.fixtureMap.once('style.load', () => {
          clearTimeout(timeout);
          resolve();
        });
        window.fixtureMap.setStyle(
          {
            version: 8,
            glyphs: window.location.origin + '/fonts/{fontstack}/{range}.pbf',
            sources: {},
            layers: [
              {
                id: 'background',
                type: 'background',
                paint: { 'background-color': '#e9efea' },
              },
            ],
          },
          { diff: false },
        );
      }),
  );
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
        3 &&
      ['peak', 'pass', 'hut'].every((kind) =>
        window.fixtureMap.hasImage('matched-place-' + kind),
      ),
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
        .length === 5,
  );
  const beforeVersionChange = requests.length;
  matchingVersion = 'b'.repeat(64);
  mode = 'pending';
  await page.evaluate(() =>
    window.client.invalidateQueries({
      queryKey: ['library', 'auth:fixture', 'place-matching-version'],
    }),
  );
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      0,
  );
  assert(
    requests.length > beforeVersionChange,
    'Catalogue change fetches again without a stream change',
  );
  await page
    .locator('[data-map-place]')
    .getByText(/^Finding places/)
    .waitFor();
  mode = 'complete';
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      3,
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
      3,
  );
  await page.evaluate(() => window.fixtureState.setState({ selected: [1] }));
  const profileHeight = await page
    .getByRole('region', { name: 'Elevation profile', exact: true })
    .evaluate((node) => node.getBoundingClientRect().height);
  holdResponse = true;
  const refresh = page.evaluate(() => window.refreshPlaces());
  await page
    .getByRole('status', { name: 'Finding places', exact: true })
    .waitFor();
  await page
    .locator('[data-map-place]')
    .getByText('Finding places', { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('region', { name: 'Elevation profile', exact: true })
      .evaluate((node) => node.getBoundingClientRect().height),
    profileHeight,
    'Loading preserves chart/card height',
  );
  assert.equal(profileHeight, 177);
  await page.screenshot({ path: join(output, 'loading.png') });
  holdResponse = false;
  releaseResponse();
  await refresh;
  mode = 'uncovered';
  await page.evaluate(() => window.refreshPlaces());
  await page
    .getByRole('status', {
      name: 'Places are currently available for routes within Switzerland, Austria and Italy.',
    })
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
    await page
      .getByRole('button', { name: /Highlight Alpine test peak/ })
      .count(),
    0,
  );
  await page.evaluate(() => window.fixtureState.setState({ selected: [] }));
  await page.waitForFunction(
    () => !window.fixtureMap.getSource('matched-places'),
  );
  assert.equal(await page.getByTestId('elevation-place-marker').count(), 0);
  // Synchronized bundles drive the actual map/profile while the direct API
  // fails, including authoritative zeroes and a manifest-only invalidation.
  await page.waitForFunction(() => window.client.isFetching() === 0);
  mode = 'error';
  owner = 'fixture';
  revision = '1';
  const bundle = {
    userId: 'fixture',
    activityId: '1',
    status: 'complete',
    streamGeneration: 'g1',
    streamRevision: '1',
    catalogueSnapshotId: 'synced-catalogue',
    matcherVersion: 'v5',
    matchingVersion,
    resultRevision: 'synced-positive',
    places: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Synced summit',
        kinds: ['peak'],
        longitude: 8.001,
        latitude: 47.001,
        elevationM: 500,
        visits: [{ distanceM: 100 }],
      },
    ],
  };
  await page.evaluate(
    async ({ bundle, version }) => {
      await window.saveSyncedPlaces(bundle, version);
      window.restoreProfile();
      window.fixtureState.setState({
        user: { id: 'fixture', stravaConnected: true },
        selected: [1],
      });
    },
    { bundle, version: matchingVersion },
  );
  await page
    .getByRole('button', {
      name: 'Highlight Synced summit at 100 m',
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      1,
  );
  const beforeSyncedReplacements = requests.length;
  await page.evaluate(
    async ({ bundle, version }) => {
      await window.saveSyncedPlaces(
        { ...bundle, resultRevision: 'synced-zero', places: [] },
        version,
      );
    },
    { bundle, version: matchingVersion },
  );
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      0,
  );
  assert.equal(await page.getByTestId('elevation-place-marker').count(), 0);
  assert.equal(
    requests.length,
    beforeSyncedReplacements,
    'Synced zero replaces visits without a per-activity request',
  );
  await page.evaluate(
    ({ bundle, version }) => window.saveSyncedPlaces(bundle, version),
    { bundle, version: matchingVersion },
  );
  await page
    .getByRole('button', {
      name: 'Highlight Synced summit at 100 m',
      exact: true,
    })
    .waitFor();
  matchingVersion = 'c'.repeat(64);
  await page.evaluate(
    (version) => window.saveSyncedPlaces(null, version),
    matchingVersion,
  );
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data?.features.length ===
      0,
  );
  assert.equal(
    await page.getByTestId('elevation-place-marker').count(),
    0,
    'Manifest-only invalidation hides profile visits',
  );
  // Overview: synced results from every displayed route, with no selection and
  // no per-activity requests, shared place identities counted only once.
  const overviewBundle = {
    ...bundle,
    matchingVersion,
    places: [
      bundle.places[0],
      {
        ...bundle.places[0],
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Synced pass',
        kinds: ['pass'],
      },
    ],
  };
  const secondBundle = {
    ...overviewBundle,
    activityId: '2',
    places: [
      bundle.places[0],
      {
        ...bundle.places[0],
        id: '00000000-0000-4000-8000-000000000003',
        name: 'Synced hut',
        kinds: ['hut'],
      },
    ],
  };
  const beforeOverview = requests.length;
  await page.evaluate(
    async ({ first, second, version }) => {
      window.clearPlaceFocus();
      window.fixtureState.setState({ selected: [], showProfile: false });
      await window.saveSyncedPlaces(first, version);
      await window.saveSyncedPlaces(second, version);
      window.fixtureState.setState({
        selected: [],
        highlighted: 0,
        showProfile: false,
        visibleIDs: [1, 2],
        showAllPlaces: true,
      });
      window.fixtureMap.jumpTo({ center: [8.001, 47.001], zoom: 10 });
    },
    { first: overviewBundle, second: secondBundle, version: matchingVersion },
  );
  const overviewCluster = page.getByRole('button', {
    name: 'Explore 3 visited places',
    exact: true,
  });
  await overviewCluster.waitFor();
  assert.equal(
    await page.locator('[data-place-cluster-kind="mixed"]').count(),
    1,
    'A group spanning peak, pass and hut uses a mixed-place pin',
  );
  assert.equal(
    requests.length,
    beforeOverview,
    'Overview uses synchronized bundles without per-activity requests',
  );
  assert.equal(await page.locator('[data-place-cluster]').count(), 1);
  const selectionCalls = await page.evaluate(() => window.selectionCalls);
  await overviewCluster.click();
  await page.waitForFunction(
    () => !window.fixtureMap.isMoving() && window.fixtureMap.getZoom() === 12,
  );
  assert.equal(
    await page.evaluate(() => window.selectionCalls),
    selectionCalls,
    'Cluster click preserves route selection',
  );
  await page.screenshot({ path: join(output, 'places-overview.png') });
  await page.evaluate(() => window.fixtureMap.jumpTo({ zoom: 18 }));
  await overviewCluster.click();
  await page
    .getByRole('button', { name: 'Synced summit', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Close place', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Explore 2 visited places', exact: true })
    .waitFor();
  assert.equal(
    await page.locator('.mapboxgl-popup a[href^="/list?activity="]').count(),
    0,
    'Place tooltip contains no activity list',
  );
  assert.deepEqual(
    await page.evaluate(() => window.placePicks),
    [[1, 2]],
    'Shared place picks all associated activities',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      selected: window.fixtureState.getState().selected,
      highlighted: window.fixtureState.getState().highlighted,
    })),
    { selected: [1, 2], highlighted: 0 },
    'Shared place uses the multiple-route chooser state',
  );
  await page.waitForFunction(
    () =>
      window.fixtureMap.getSource('matched-places')?._data.features.length ===
      1,
  );
  await page.screenshot({ path: join(output, 'places-focused.png') });
  await page.waitForFunction(
    () =>
      window.fixtureMap.getLayer('routeLayerBG') &&
      !window.fixtureMap.isMoving(),
  );
  const backgroundPixel = await page.evaluate(() => {
    const rect = window.fixtureMap.getCanvas().getBoundingClientRect();
    return { x: rect.x + 60, y: rect.y + 50 };
  });
  await page.mouse.click(backgroundPixel.x, backgroundPixel.y);
  await page
    .getByRole('button', { name: 'Close place', exact: true })
    .waitFor({ state: 'hidden' });
  assert.deepEqual(
    await page.evaluate(() => window.fixtureState.getState().selected),
    [],
    'A background map click clears the activities and the focused place together',
  );
  await page.evaluate(() =>
    window.fixtureState.setState({ selected: [], visibleIDs: [2] }),
  );
  await page
    .getByRole('button', { name: 'Explore 2 visited places', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Explore 2 visited places', exact: true })
    .click();
  await page.getByRole('button', { name: 'Synced hut', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.placePicks),
    [[1, 2], [2]],
    'Filtered place picks only its displayed activities',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      selected: window.fixtureState.getState().selected,
      highlighted: window.fixtureState.getState().highlighted,
    })),
    { selected: [2], highlighted: 2 },
    'A single matching activity uses the single-route detail state',
  );
  await page.getByRole('button', { name: 'Close place', exact: true }).click();
  const beforeInspectingPlace = await page.evaluate(
    () => window.placePicks.length,
  );
  await page.evaluate(() =>
    window.fixtureState.setState({
      selected: [1],
      highlighted: 1,
      inspectedActivityId: 1,
      visibleIDs: [1, 2],
    }),
  );
  await page
    .getByRole('button', { name: 'Explore 3 visited places', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Synced summit', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Close place', exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.placePicks.length),
    beforeInspectingPlace,
    'A place on the inspected activity does not pick other activities',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      selected: window.fixtureState.getState().selected,
      highlighted: window.fixtureState.getState().highlighted,
      inspectedActivityId: window.fixtureState.getState().inspectedActivityId,
    })),
    { selected: [1], highlighted: 1, inspectedActivityId: 1 },
    'Looking up a shared place preserves the inspected activity and selection',
  );
  await page.getByRole('button', { name: 'Close place', exact: true }).click();
  await page
    .getByRole('button', { name: 'Explore 3 visited places', exact: true })
    .click();
  await page.getByRole('button', { name: 'Synced hut', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.placePicks.length),
    beforeInspectingPlace + 1,
    'A place outside the inspected activity still picks matching activities',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      selected: window.fixtureState.getState().selected,
      inspectedActivityId: window.fixtureState.getState().inspectedActivityId,
    })),
    { selected: [2], inspectedActivityId: 2 },
    'An unvisited place switches to its matching activity',
  );
  await page.getByRole('button', { name: 'Close place', exact: true }).click();
  await page.evaluate(() =>
    window.fixtureState.setState({
      selected: [],
      inspectedActivityId: undefined,
      visibleIDs: [2],
    }),
  );
  await page.evaluate(
    async ({ second, version }) => {
      await window.saveSyncedPlaces(
        { ...second, places: [], resultRevision: 'overview-zero' },
        version,
      );
    },
    { second: secondBundle, version: matchingVersion },
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-place-cluster]').length === 0 &&
      window.fixtureMap.getSource('matched-places')?._data.features.length ===
        0,
  );
  await page.evaluate(() => window.fixtureState.setState({ visibleIDs: [1] }));
  await page
    .getByRole('button', { name: 'Explore 2 visited places', exact: true })
    .waitFor();
  await page.evaluate(() =>
    window.fixtureState.setState({ showAllPlaces: false }),
  );
  await page.waitForFunction(
    () =>
      !window.fixtureMap.getSource('matched-places') &&
      document.querySelectorAll('[data-place-cluster]').length === 0,
  );
  assert.equal(
    requests.length,
    beforeOverview,
    'Filtering, focus and toggling never fetch unselected activities',
  );
  await page.evaluate(() =>
    window.fixtureState.setState({ showAllPlaces: true }),
  );
  await page
    .getByRole('button', { name: 'Explore 2 visited places', exact: true })
    .waitFor();
  await page.evaluate(() =>
    window.fixtureState.setState({
      user: { id: 'other', stravaConnected: true },
    }),
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-place-cluster]').length === 0 &&
      window.fixtureMap.getSource('matched-places')?._data.features.length ===
        0,
  );
  assert.equal(
    requests.length,
    beforeOverview,
    'Changing accounts never loads unselected activities or retains the previous overview',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        requests,
        checks: [
          'shared requests',
          'cached profile reopen',
          'synchronized bundles without per-activity requests',
          'synchronized zero replacement',
          'manifest-only invalidation',
          'map style replacement',
          'distinct peak/pass/hut symbols',
          'fixed-height loading',
          'no duplicate place list',
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
          'overview without selection or per-activity requests',
          'overview deduplication and filter scope',
          'cluster zoom preserves selection',
          'coincident place chooser and focused symbol',
          'place pick uses associated activities without tooltip links',
          'single and filtered place pick',
          'background map click clears place focus with activities',
          'visited place preserves activity detail; unvisited place picks matches',
          'overview zero replacement and toggle',
          'overview account isolation',
        ],
        screenshots: [
          'desktop.png',
          'mobile-dark.png',
          'loading.png',
          'places-overview.png',
          'places-focused.png',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS web matching: actual Mapbox layers, profile annotations, shared requests, keyboard focus, multi-selection, filters, account isolation, stream replacement, retry and coverage states.',
  );
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: join(output, 'failure.png') })
      .catch(() => undefined);
    await writeFile(
      join(output, 'failure.json'),
      JSON.stringify({ error: String(error), errors, requests }, null, 2),
    );
  }
  throw error;
} finally {
  await browser.close();
  server.close();
}
