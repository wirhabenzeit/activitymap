// Exercise the production photo UI against synthetic image responses, without a backend.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve('esbuild', {
    paths: [dirname(require.resolve('tsx/package.json'))],
  }),
);
const repo = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'map-photos-'));
const evidence = resolve(process.argv[2] || directory);
await mkdir(evidence, { recursive: true });
const requests = [];
let repairBroken = false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (/^\/(thumb|full)-/.test(path)) {
    requests.push(path);
    if (path === '/full-4' && !repairBroken) {
      response.writeHead(404);
      response.end('missing');
      return;
    }
    const id = Number(path.at(-1));
    const [width, height] =
      id === 2 ? [900, 1600] : id === 3 ? [1600, 400] : [1600, 900];
    response.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
    });
    response.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#789bac"/><path d="M0 ${height} L${width * 0.25} ${height * 0.3} L${width * 0.5} ${height * 0.7} L${width * 0.8} ${height * 0.2} L${width} ${height * 0.65} V${height}" fill="#486d64"/><text x="10%" y="15%" fill="white" font-family="sans-serif" font-size="${Math.min(width, height) * 0.06}">Photo ${id}</text></svg>`,
    );
    return;
  }
  const name = path === '/' ? 'index.html' : path.slice(1);
  if (!['index.html', 'app.css', 'fixture.css', 'fixture.js'].includes(name)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': name.endsWith('.html')
      ? 'text/html'
      : name.endsWith('.css')
        ? 'text/css'
        : 'application/javascript',
  });
  response.end(await readFile(join(directory, name)));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
server.unref();
const baseURL = `http://127.0.0.1:${server.address().port}`;
await writeFile(
  join(directory, 'actions.ts'),
  'export const updateActivity=()=>{}; export const deleteActivities=()=>{};',
);
await writeFile(
  join(directory, 'env.ts'),
  'export const env={NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN:"pk.offline-test"};',
);
await writeFile(
  join(directory, 'photos.ts'),
  'export function usePhotos(){ return {data:window.photoFixtures}; }',
);
await writeFile(
  join(directory, 'navigation.ts'),
  'export function useRouter(){return {push:path=>window.navigationTarget=path};}',
);
await writeFile(
  join(directory, 'activities.ts'),
  'export function useFilteredActivities(){ return {filterIDs:[1]}; }',
);
const bundleConfig = {
  absWorkingDir: repo,
  nodePaths: [join(repo, 'node_modules')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: join(directory, 'fixture.js'),
  alias: {
    '~': join(repo, 'src'),
    'next/navigation': join(directory, 'navigation.ts'),
    'next/image': join(
      repo,
      'node_modules/next/dist/esm/shared/lib/image-external.js',
    ),
    '~/server/strava/actions': join(directory, 'actions.ts'),
    '~/env': join(directory, 'env.ts'),
    '~/hooks/use-photos': join(directory, 'photos.ts'),
    '~/hooks/use-filtered-activities': join(directory, 'activities.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Map, {Source,Layer} from 'react-map-gl/mapbox';
import {MapPhotos} from '~/components/map/photo';
import {Selection} from '~/components/map/selection-control';
import {store} from '~/store';
import 'mapbox-gl/dist/mapbox-gl.css';
const photo=(id,activity,location)=>({unique_id:id,activity_id:activity,athlete_id:1,activity_name:'Activity '+activity,caption:'Caption '+id,created_at:new Date('2026-01-01'),location,
 urls:{256:'${baseURL}/thumb-1',1600:'${baseURL}/full-1'},sizes:{256:[256,256],1600:[1600,900]}});
const fixture=[photo('a',1,[46,8]),photo('b',2,[46,8]),photo('c',1,[46.15,8.15]),photo('unlocated',1,null),photo('invalid',1,[91,8]),photo('offscreen',1,[0,0])];
store.getState().reconcileSelection([1,2], [1,2]);
store.getState().pickActivities([2]);
window.store=store;
function App(){
 const [photos,setPhotos]=useState(fixture), [visible,setVisible]=useState([1,2]), [show,setShow]=useState(true), [revision,setRevision]=useState(0);
 window.setVisible=setVisible;window.setPhotos=setPhotos;window.photoFixtures=fixture;window.setShow=setShow;window.resetScope=()=>setRevision(x=>x+1);
 return <Map ref={ref=>window.photoMap=ref} onIdle={()=>window.mapReady=true} initialViewState={{latitude:46,longitude:8,zoom:10}} mapboxAccessToken="pk.offline-test"
 preserveDrawingBuffer style={{height:'100vh',width:'100vw'}} mapStyle={{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e6e9e3'}}]}}>
 <Source id="routeSource" type="geojson" data={{type:'FeatureCollection',features:[{type:'Feature',id:1,properties:{},geometry:{type:'LineString',coordinates:[[7.9,46],[8.1,46]]}}]}}>
 <Layer id="routeLayerBG" type="line" paint={{'line-color':'#237b4b','line-width':12}}/></Source>
 <Selection onSelection={ids=>{window.routeClicks=(window.routeClicks||0)+1;store.getState().pickActivities(ids);}}/>
 {show&&<MapPhotos key={revision} photos={photos} visibleIDs={visible}/>}
 </Map>;
}
createRoot(document.getElementById('root')).render(<App/>);

`,
  },
};
await build(bundleConfig);

const cssPath = join(repo, 'src/styles/globals.css');
const styles = await require('postcss')([
  require('@tailwindcss/postcss')(),
]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
await writeFile(join(directory, 'app.css'), styles.css);
await writeFile(
  join(directory, 'index.html'),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="fixture.css"><style>
body{font:14px system-ui;margin:0;background:hsl(var(--background));color:hsl(var(--foreground));min-height:1400px}h1{font-size:20px;margin:16px 0}svg{display:block}
</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`,
);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://**', (route) => route.abort());
  await page.goto(baseURL);
  await page.waitForFunction(
    () => window.mapReady && document.querySelector('[data-map-photo]'),
  );
  const pin = page.getByRole('button', {
    name: 'Zoom into 2 photos',
    exact: true,
  });
  await pin.waitFor();
  const pinBox = await pin.boundingBox();
  const pinVisual = await pin
    .locator('[data-photo-appearance="pin"]')
    .boundingBox();
  assert(
    pinBox.width >= 44 &&
      pinBox.height >= 44 &&
      pinVisual.width === 28 &&
      pinVisual.height === 28,
    'Compact pin retains a 44px tap target',
  );
  assert.equal(requests.length, 0, 'Zoomed out pins fetch no image bytes');
  assert.equal(
    await page
      .locator(
        '[data-map-photo="unlocated"], [data-map-photo="invalid"], [data-map-photo="offscreen"]',
      )
      .count(),
    0,
  );
  await page.screenshot({
    path: join(evidence, 'web-map-photo-pins-ipad.png'),
  });
  const selected = await page.evaluate(() => window.store.getState().selected);
  await pin.click();
  const stack = page.getByRole('button', {
    name: 'View 2 photos: Activity 1',
    exact: true,
  });
  await stack.waitFor();
  await stack.locator('img').waitFor();
  const thumbVisual = await stack
    .locator('[data-photo-appearance="thumbnail"]')
    .boundingBox();
  assert(
    thumbVisual.width === 36 && thumbVisual.height === 36,
    'Thumbnails are visually compact',
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.photoMap.getMap();
        map.once('render', resolve);
        map.triggerRepaint();
      }),
  );
  await page.screenshot({
    path: join(evidence, 'web-map-photo-thumbnails-ipad.png'),
  });
  assert(
    requests.every((p) => p.startsWith('/thumb-')),
    'Zoomed in map fetches thumbnails only',
  );
  assert.equal(
    await page.evaluate(() =>
      window.photoMap
        .getMap()
        .queryRenderedFeatures(window.photoMap.project([8, 46]), {
          layers: ['routeLayerBG'],
        })
        .some((f) => f.id === 1),
    ),
    true,
    'Photo stack overlaps an actual rendered route',
  );
  await stack.click();
  const viewer = page.getByRole('dialog', { name: 'Activity 1', exact: true });
  await viewer.getByText('1 of 2', { exact: true }).waitFor();
  await viewer.getByText('Caption a', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.routeClicks || 0),
    0,
    'Photo touch cannot select underlying route',
  );
  assert.deepEqual(
    await page.evaluate(() => window.store.getState().selected),
    selected,
  );
  await viewer.getByRole('button', { name: 'Next photo', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Activity 2', exact: true })
    .getByText('Caption b', { exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'View activity', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => window.navigationTarget),
    '/list?activity=2',
  );
  assert.deepEqual(
    await page.evaluate(() => window.store.getState().selected),
    selected,
  );
  await stack.click();
  await viewer.waitFor();
  await page.evaluate(() => window.setVisible([2]));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const only = page.getByRole('button', {
    name: 'View photo: Activity 2',
    exact: true,
  });
  await only.waitFor();
  await only.click();
  await page
    .getByRole('dialog', { name: 'Activity 2', exact: true })
    .getByText('1 of 1', { exact: true })
    .waitFor();
  await page.evaluate(() =>
    window.setPhotos(window.photoFixtures.filter((p) => p.unique_id !== 'b')),
  );
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-map-photo]').count(), 0);
  await page.evaluate(() => {
    window.setPhotos(window.photoFixtures);
    window.setVisible([1, 2]);
  });
  await stack.waitFor();
  await stack.click();
  await viewer.waitFor();
  await page.evaluate(() => window.resetScope());
  await viewer.waitFor({ state: 'hidden' });
  const camera = await page.evaluate(() => ({
    center: window.photoMap.getCenter().toArray(),
    zoom: window.photoMap.getZoom(),
  }));
  await page.evaluate(() => window.setShow(false));
  await page.locator('[data-map-photo]').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.setShow(true));
  await stack.waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      center: window.photoMap.getCenter().toArray(),
      zoom: window.photoMap.getZoom(),
    })),
    camera,
    'Visibility never reframes map',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await stack.waitFor();
  await page.screenshot({
    path: join(evidence, 'web-map-photo-thumbnails-phone.png'),
  });
  await page.evaluate(() =>
    window.photoMap.jumpTo({ center: [0, 0], zoom: 13 }),
  );
  await page
    .getByRole('button', { name: 'View photo: Activity 1', exact: true })
    .waitFor();
  assert.equal(
    await page.locator('[data-map-photo="offscreen"]').count(),
    1,
    'Zero coordinates are valid and viewport membership refreshes',
  );
  await page.evaluate(() => window.setVisible([]));
  await page.locator('[data-map-photo]').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, 'web-map-photo-verification.json'),
    JSON.stringify(
      {
        errors,
        requests,
        checks: [
          'pins without image requests',
          'zoom into thumbnails',
          'counted co-located stack',
          'correct photo and activity navigation',
          'route hit precedence',
          'selection preserved',
          'filter invalidation',
          'deletion',
          'scope reset',
          'visibility without camera move',
          'phone/tablet sizing',
          'zero coordinates',
          'viewport refresh',
          'empty filter',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Map photo browser checks passed. Evidence: ' + evidence);
} finally {
  await browser.close();
  server.close();
}
