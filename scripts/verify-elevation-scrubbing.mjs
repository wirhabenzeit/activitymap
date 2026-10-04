// Isolated browser integration: production chart + Mapbox marker, deterministic
// summaries and activity/auth hooks. No backend, credentials or raw streams.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('tsx/package.json'))] }));
const repo = resolve(import.meta.dirname, '..');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const directory = await mkdtemp(join(tmpdir(), 'elevation-scrubbing-'));
const fixtureStore = `
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
export const state = create(() => ({ user: {id:'fixture',stravaConnected:true}, selected:[1], highlighted:1, isGuest:false, visible:true, showProfile:true }));
export const useShallowStore = selector => state(useShallow(selector));
window.fixtureState = state;
`;
await build({
  absWorkingDir: repo, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: join(directory, 'fixture.js'), alias: { '~': join(repo, 'src') },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'activity-fixtures', setup(builder) {
    builder.onResolve({ filter: /^~\/store$/ }, () => ({ path: 'store', namespace: 'fixture' }));
    builder.onResolve({ filter: /^~\/hooks\/(use-activities|use-filtered-activities)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: repo, contents:
      args.path === 'store' ? fixtureStore : args.path.endsWith('use-activities')
        ? `export const useActivities = () => ({data:[{id:1, streamsMetadata:window.fixtureMetadata}]});`
        : `import { useShallowStore } from '~/store'; export const useFilteredActivities = () => ({filterIDs:useShallowStore(state=>state.visible)?[1]:[]});`
    }));
  }}],
  stdin: { resolveDir: repo, loader: 'tsx', contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Map, { Source, Layer } from 'react-map-gl/mapbox';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ElevationChart } from '~/components/list/elevation-chart';
import { ElevationRouteMarker } from '~/components/map/elevation-route-marker';
import { encodeStreamSummary } from '~/lib/streams/compact-summary';
import { streamSummaryQueryKey } from '~/lib/activity-stream-summary';
import { useElevationCursor } from '~/store/elevation-cursor';
import { useShallowStore } from '~/store';
const metadata = window.fixtureMetadata = {generation:'g1',revision:'1',state:'current',fetch_status:'succeeded',available_types:['distance','altitude','latlng'],fetched_at:null,expires_at:null};
const latlng = [[47,8],[47.001,8.001],[47.002,8.003],[47.004,8.005]];
const source = {metadata,summary:encodeStreamSummary({version:1,basis:'distance',distance:[100,18360,91400,182700],altitude:[400,410,405,450],latlng}),requestedAgainst:metadata,status:'ready',message:null,retryAt:null,pollStartedAt:0,pollAttempts:0};
const client = new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
client.setQueryData(streamSummaryQueryKey('fixture','1'),source);
window.cursorState=useElevationCursor;
window.invalidateProfile=()=>client.setQueryData(streamSummaryQueryKey('fixture','1'), {...source, metadata:{...metadata,state:'stale'}});
function App(){
 const visible=useShallowStore(state=>state.showProfile);
 return <QueryClientProvider client={client}>
 <Map onIdle={()=>window.mapReady=true} initialViewState={{latitude:47.002,longitude:8.003,zoom:14}} mapboxAccessToken="pk.offline-test"
 style={{height:260,width:'100%'}} mapStyle={{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eef1ed'}}]}}>
 <Source type="geojson" data={{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:latlng.map(([lat,lng])=>[lng,lat])}}}>
 <Layer type="line" paint={{'line-color':'#ed9933','line-width':5}} />
 </Source><ElevationRouteMarker /></Map>
 {visible && <ElevationChart activityId="1" userId="fixture" streamMetadata={metadata}/>}
 </QueryClientProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
` },
});
const cssPath = join(repo, 'src/styles/globals.css');
const styles = await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
await writeFile(join(directory, 'app.css'), styles.css);
await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><style>
body{font:14px system-ui;margin:20px;background:hsl(var(--background));color:hsl(var(--foreground))}#root{max-width:600px}svg{display:block}section{margin-top:12px}
</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 700, height: 520 }, hasTouch: true });
  const page = await context.newPage();
  // Mapbox telemetry is irrelevant to this local-style test.
  await page.route('https://**', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`file://${join(directory, 'index.html')}`);
  const plot = page.getByRole('slider');
  await plot.waitFor();
  await page.waitForFunction(() => window.mapReady === true);
  const bounds = await plot.boundingBox();
  const at = fraction => ({x:bounds.x+48+fraction*(bounds.width-60), y:bounds.y+60});
  const point = at(0.5);
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => window.cursorState.getState().cursor?.coordinate[0] === 47.002);
  const marker = page.getByTestId('elevation-route-marker');
  await marker.waitFor();
  const first = await marker.boundingBox();
  assert.equal(await marker.evaluate(element => getComputedStyle(element.parentElement).position), 'absolute', 'The application stylesheet positions the map cursor as an overlay');
  const mapBounds = await page.locator('.mapboxgl-map').boundingBox();
  assert.ok(first.y >= mapBounds.y && first.y + first.height <= mapBounds.y + mapBounds.height, 'The dot is inside the map, not below its canvas');
  const end = at(1);
  await page.mouse.move(end.x, end.y);
  await page.waitForFunction(() => window.cursorState.getState().cursor?.coordinate[0] === 47.004);
  const last = await marker.boundingBox();
  assert.notEqual(first.y, last.y, 'Map dot moves with the chart sample');
  const readout = page.getByTestId('elevation-selection-readout');
  assert.equal(await readout.textContent(), '182.6 km · 450 m');
  const readoutBox = await readout.boundingBox();
  const graphBox = await page.getByTestId('elevation-plot-area').boundingBox();
  assert.ok(readoutBox.y + readoutBox.height <= graphBox.y, 'Selected values stay above the plot');
  const style = await readout.evaluate(element => ({color:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor}));
  assert.notEqual(style.color, style.background);
  assert.ok(!style.background.includes('rgba'), 'The readout must have an opaque background');
  assert.deepEqual(await page.getByTestId('elevation-plot-area').locator('text').allTextContents(), ['400', '420', '440', '0', '50', '100', '150', 'Distance (km)']);
  const heightBefore = (await plot.boundingBox()).height;
  await page.screenshot({path:join(directory,'web-scrubbing.png')});
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({path:join(directory,'web-scrubbing-dark.png')});
  await page.setViewportSize({width:390,height:640});
  await plot.focus(); await page.keyboard.press('End');
  const narrowReadout = await readout.boundingBox();
  const narrowChart = await plot.boundingBox();
  assert.ok(narrowReadout.x >= narrowChart.x && narrowReadout.x + narrowReadout.width <= narrowChart.x + narrowChart.width, 'Mobile readout stays within the card');
  await page.screenshot({path:join(directory,'web-scrubbing-mobile-dark.png')});
  await page.setViewportSize({width:700,height:520});
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.keyboard.press('Escape');
  await page.mouse.move(end.x, end.y);
  await page.mouse.move(680, 500);
  await marker.waitFor({state:'detached'});
  assert.equal((await plot.boundingBox()).height, heightBefore, 'Selection does not resize the chart');
  await plot.focus();
  await page.keyboard.press('Home');
  assert.equal(await plot.getAttribute('aria-valuenow'), '0');
  await page.keyboard.press('ArrowRight');
  assert.equal(await plot.getAttribute('aria-valuenow'), '1');
  await page.keyboard.press('End');
  assert.equal(await plot.getAttribute('aria-valuenow'), '3');
  await page.keyboard.press('Escape');
  await marker.waitFor({state:'detached'});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[at(0)]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[at(0.5)]});
  await page.waitForFunction(() => window.cursorState.getState().cursor?.coordinate[0] === 47.002);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await marker.waitFor({state:'detached'});
  await plot.focus(); await page.keyboard.press('End');
  await page.evaluate(() => window.fixtureState.setState({visible:false}));
  await marker.waitFor({state:'detached'});
  await page.evaluate(() => window.fixtureState.setState({visible:true,user:{id:'other',stravaConnected:true}}));
  assert.equal(await marker.count(),0);
  await page.evaluate(() => window.fixtureState.setState({user:{id:'fixture',stravaConnected:true}}));
  await marker.waitFor();
  await page.evaluate(() => window.fixtureState.setState({showProfile:false}));
  await marker.waitFor({state:'detached'});
  assert.equal(await page.evaluate(() => window.cursorState.getState().cursor), null);
  await page.evaluate(() => window.fixtureState.setState({showProfile:true}));
  await plot.focus(); await page.keyboard.press('End');
  await page.evaluate(() => window.invalidateProfile());
  await marker.waitFor({state:'detached'});
  await plot.waitFor({state:'detached'});
  assert.deepEqual(errors, []);
  console.log('PASS: readable non-overlapping light/dark/mobile readout, round axes, stable height, mouse, touch, keyboard, route-dot movement, filters, account change, unmount and invalidation.');
  console.log(`Screenshot: ${join(directory,'web-scrubbing.png')}`);
} finally { await browser.close(); }
