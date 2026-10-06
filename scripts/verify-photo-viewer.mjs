// Exercise the production photo UI against synthetic image responses, without a backend.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
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
const baselineRevision = '55528efd7769dba350ce28d111ee2d39c0b50258';
const directory = await mkdtemp(join(tmpdir(), 'photo-viewer-'));
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
  if (
    ![
      'index.html',
      'baseline.html',
      'app.css',
      'fixture.js',
      'baseline.js',
      'baseline.css',
    ].includes(name)
  ) {
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
import Map from 'react-map-gl/mapbox';
import {PhotoLightbox} from '~/components/list/photo';
import PhotoLayer from '~/components/map/photo';
import {Dialog, DialogContent, DialogTitle, DialogTrigger} from '~/components/ui/dialog';
import {store} from '~/store';
const photo = (id, width, height, caption, urls=true) => ({unique_id:id,activity_id:1,athlete_id:1,caption,activity_name:'Afternoon on the ridge',created_at:new Date('2026-01-0'+id+'T00:00:00Z'),
 urls:urls ? {256:'${baseURL}/thumb-'+id,1600:'${baseURL}/full-'+id} : {},sizes:{256:[256,256],1600:[width,height]},location:[0,0]});
window.photoFixtures = [photo('1',1600,900,'A quiet afternoon on the ridge'), photo('2',900,1600,'Looking down into the valley'), photo('3',1600,400,'A panorama across the mountains'),photo('4',1600,900,'This photograph is temporarily unavailable'),photo('5',1600,900,'Metadata without image bytes',false)];
store.getState().reconcileSelection([1,2], [1,2]);
store.setState({position:{...store.getState().position,latitude:0,longitude:0,zoom:10}});
window.store=store;
function App(){
 const [photos,setPhotos]=useState(window.photoFixtures);
 window.removePhoto=id=>setPhotos(p=>p.filter(x=>x.unique_id!==id));
 window.resetPhotos=()=>setPhotos(window.photoFixtures);
 window.onlyPhoto=id=>setPhotos(window.photoFixtures.filter(p=>p.unique_id===id));
 return <div>
 <h1>Activity photos</h1><div data-testid="row" onClick={()=>window.rowClicks=(window.rowClicks||0)+1}>
 <PhotoLightbox photos={photos} title="Afternoon on the ridge" className="h-20" /></div>
 <Dialog><DialogTrigger>Open activity detail</DialogTrigger><DialogContent><DialogTitle>Activity detail</DialogTitle><PhotoLightbox photos={photos} title="Detail photos"/></DialogContent></Dialog>
 <div style={{height:260,marginTop:32}}><Map onIdle={()=>window.mapReady=true} initialViewState={{latitude:0,longitude:0,zoom:10}} mapboxAccessToken="pk.offline-test"
 mapStyle={{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e6e9e3'}}]}}><PhotoLayer/></Map></div>
 <button onClick={()=>window.underlyingClicks=(window.underlyingClicks||0)+1}>Underlying action</button>
 </div>;
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
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><style>
body{font:14px system-ui;margin:24px;background:hsl(var(--background));color:hsl(var(--foreground));min-height:1400px}h1{font-size:20px;margin:16px 0}svg{display:block}
</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.route('https://**', (route) => route.abort());
  await page.goto(baseURL);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="row"]') ||
      document.body.textContent.includes('Application error'),
  );
  assert.deepEqual(errors, []);
  const row = page.getByTestId('row');
  const thumbnail = (n) =>
    row.getByRole('button', { name: new RegExp(`^View photo ${n} of 5:`) });
  await thumbnail(2).focus();
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', {
    name: 'Afternoon on the ridge',
    exact: true,
  });
  await viewer.waitFor();
  await viewer.getByText('2 of 5', { exact: true }).waitFor();
  await viewer
    .getByText('Looking down into the valley', { exact: true })
    .waitFor();
  await viewer.locator('img').waitFor();
  await viewer
    .locator('img')
    .evaluate((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) =>
            img.addEventListener('load', resolve, { once: true }),
          ),
    );
  assert.ok(requests.includes('/full-2'));
  assert.ok(
    !requests.includes('/full-1') && !requests.includes('/full-3'),
    'Only the current full image is fetched',
  );
  assert.equal(
    await page.evaluate(() => window.rowClicks || 0),
    0,
    'Inspection does not expand/select the row',
  );
  assert.equal(
    await page.evaluate(() => document.body.getAttribute('data-scroll-locked')),
    '1',
  );
  await page.screenshot({ path: join(evidence, 'web-portrait-phone.png') });
  await page.keyboard.press('ArrowRight');
  await viewer.getByText('3 of 5', { exact: true }).waitFor();
  const cdp = await context.newCDPSession(page);
  async function swipe(from, to) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from, y: 300 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: to, y: 302 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  }
  await swipe(280, 100);
  await viewer.getByText('4 of 5', { exact: true }).waitFor();
  await swipe(100, 280);
  await viewer.getByText('3 of 5', { exact: true }).waitFor();
  await viewer.locator('img').click();
  assert.equal(await viewer.isVisible(), true, 'Image click does not dismiss');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: join(evidence, 'web-panorama-desktop.png') });
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(
      () => document.activeElement.closest('[role="dialog"]') !== null,
    ),
    true,
    'Focus stays in viewer',
  );
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    (element) => element === document.activeElement,
    await thumbnail(2).elementHandle(),
  );
  assert.equal(
    await thumbnail(2).evaluate((e) => e === document.activeElement),
    true,
    'Focus returns to invoker',
  );
  await thumbnail(3).focus();
  await page.keyboard.press('Space');
  await viewer.getByText('3 of 5', { exact: true }).waitFor();
  await viewer.getByRole('button', { name: 'Close photo viewer' }).click();
  await thumbnail(4).click();
  await viewer.getByText('Photo unavailable', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, 'web-broken-image.png') });
  repairBroken = true;
  await viewer.getByRole('button', { name: 'Retry', exact: true }).click();
  await viewer.locator('img').waitFor();
  await viewer.getByRole('button', { name: 'Next photo' }).click();
  await viewer.getByText('5 of 5', { exact: true }).waitFor();
  assert.equal(
    await viewer.getByRole('button', { name: 'Next photo' }).isEnabled(),
    false,
  );
  assert.equal(
    await viewer.getByRole('button', { name: 'Retry', exact: true }).count(),
    0,
    'Missing URL does not make a request',
  );
  await page.evaluate(() => window.removePhoto('1'));
  await viewer.getByText('4 of 4', { exact: true }).waitFor();
  await page.evaluate(() => window.removePhoto('5'));
  await viewer.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.resetPhotos());
  await thumbnail(2).click();
  await page.evaluate(() =>
    window.store
      .getState()
      .initializeAuth({ currentUser: { id: 'another-user' } }),
  );
  await viewer.waitFor({ state: 'hidden' });
  await page
    .getByRole('button', { name: 'Open activity detail', exact: true })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Activity detail',
    exact: true,
  });
  await detail.getByRole('button', { name: /^View photo 2 of 5:/ }).click();
  const nested = page.getByRole('dialog', {
    name: 'Detail photos',
    exact: true,
  });
  await nested.getByText('2 of 5', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await nested.waitFor({ state: 'hidden' });
  assert.equal(
    await detail.isVisible(),
    true,
    'Closing photos retains activity detail',
  );
  await page.keyboard.press('Escape');
  await detail.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.mapReady === true);
  const marker = page
    .getByRole('button', {
      name: 'Select Afternoon on the ridge and preview photo',
    })
    .last();
  await marker.click();
  assert.deepEqual(
    await page.evaluate(() => window.store.getState().selected),
    [1],
  );
  const preview = page.getByText('View photos', { exact: true });
  await preview.waitFor();
  await page
    .getByRole('button', { name: /^View photo 5 of 5:/ })
    .last()
    .click();
  await viewer.getByText('5 of 5', { exact: true }).waitFor();
  await viewer.getByRole('button', { name: 'Previous photo' }).click();
  await viewer.getByText('4 of 5', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'hidden' });
  assert.equal(
    await preview.isVisible(),
    true,
    'Viewer close restores marker preview',
  );
  await page.keyboard.press('Escape'); // dismiss marker preview
  await page.evaluate(() => window.onlyPhoto('2'));
  const only = row.getByRole('button', { name: /^View photo 1 of 1:/ });
  await only.click();
  await viewer.getByText('1 of 1', { exact: true }).waitFor();
  assert.equal(
    await viewer.getByRole('button', { name: 'Next photo' }).count(),
    0,
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.onlyPhoto('absent'));
  await row.getByRole('button').waitFor({ state: 'hidden' });
  assert.equal(
    await row.getByRole('button').count(),
    0,
    'Empty gallery is omitted',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(evidence, 'web-verification.json'),
    JSON.stringify(
      {
        viewportSizes: [
          { width: 390, height: 844 },
          { width: 1280, height: 800 },
        ],
        errors,
        requests,
        checks: [
          'non-first initial photo',
          'reopen',
          'one-full-request',
          'captions/count',
          'image click',
          'keyboard',
          'touch swipes',
          'single/empty galleries',
          'focus return/containment',
          'scroll lock',
          'missing/broken/retry',
          'deletion',
          'account switch',
          'nested detail',
          'origin marker/selection/preview',
        ],
      },
      null,
      2,
    ),
  );
  const legacyPath = join(directory, 'legacy-photo.tsx');
  await writeFile(
    legacyPath,
    execFileSync('git', ['show', `${baselineRevision}:src/components/list/photo.tsx`], {
      cwd: repo,
      encoding: 'utf8',
    }),
  );
  await build({
    ...bundleConfig,
    outfile: join(directory, 'baseline.js'),
    alias: { ...bundleConfig.alias, 'legacy-photo': legacyPath },
    stdin: {
      ...bundleConfig.stdin,
      contents: bundleConfig.stdin.contents
        .replace("from '~/components/list/photo'", "from 'legacy-photo'")
        .replace(
          'useState(window.photoFixtures)',
          'useState(window.photoFixtures.slice(0,3))',
        ),
    },
  });
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  await writeFile(
    join(directory, 'baseline.html'),
    html
      .replace('fixture.js', 'baseline.js')
      .replace('app.css', 'baseline.css'),
  );
  const baselineStyles = await require('postcss')([
    require('@tailwindcss/postcss')(),
  ]).process((await readFile(cssPath, 'utf8')) + `\n@source "${legacyPath}";`, {
    from: cssPath,
  });
  await writeFile(join(directory, 'baseline.css'), baselineStyles.css);
  const before = await context.newPage();
  await before.setViewportSize({ width: 1280, height: 800 });
  await before.route('https://**', (route) => route.abort());
  await before.goto(baseURL + '/baseline.html');
  await before
    .getByTestId('row')
    .getByRole('img', { name: 'Looking down into the valley', exact: true })
    .click();
  await before
    .getByRole('dialog', { name: 'Afternoon on the ridge', exact: true })
    .waitFor();
  const legacyDialog = before.getByRole('dialog', {
    name: 'Afternoon on the ridge',
    exact: true,
  });
  await legacyDialog.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  await legacyDialog
    .locator('img')
    .first()
    .evaluate((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) =>
            image.addEventListener('load', resolve, { once: true }),
          ),
    );
  await before.screenshot({ path: join(evidence, 'web-before-desktop.png') });
  await writeFile(
    join(evidence, 'baseline.json'),
    JSON.stringify(
      {
        revision: execFileSync('git', ['rev-parse', baselineRevision], {
          cwd: repo,
          encoding: 'utf8',
        }).trim(),
        tappedPhoto: '2',
        entry: 'legacy production PhotoLightbox',
      },
      null,
      2,
    ),
  );
  console.log(`Photo viewer checks passed. Evidence: ${evidence}`);
} finally {
  await browser.close();
  server.close();
}
