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
const temp = await mkdtemp(join(tmpdir(), 'place-search-'));
const output = join(root, 'output/quality/browser/place-search');
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
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: 'navigation',
          namespace: 'fixture',
        }));
        builder.onResolve({ filter: /^~\/server\/strava\/actions$/ }, () => ({
          path: 'actions',
          namespace: 'fixture',
        }));
        builder.onResolve({ filter: /^~\/server\/db\/actions$/ }, () => ({
          path: 'reads',
          namespace: 'fixture',
        }));
        builder.onResolve({ filter: /use-library-snapshot$/ }, () => ({
          path: 'snapshot',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          resolveDir: root,
          contents:
            args.path === 'navigation'
              ? `export const useRouter=()=>({push:url=>{window.destination=url;}});`
              : args.path === 'actions'
                ? `export function updateActivity(){throw Error('Unexpected external write');} export function deleteActivities(){throw Error('Unexpected external write');}`
                : args.path === 'reads'
                  ? `export async function getPublicActivities(){throw Error('Unexpected guest read');} export async function getPublicUserActivities(){throw Error('Unexpected guest read');}`
                  : `import {useMemo,useSyncExternalStore} from 'react';import {useShallowStore} from '~/store';const refetch=async()=>{};export function useLibrarySnapshot(){const activities=useSyncExternalStore(window.subscribeActivities,()=>window.fixtureDTOs);const userId=useShallowStore(s=>s.user?.id);return useMemo(()=>({scope:'auth:'+userId,snapshot:{activities,loaded:true,completeness:'complete',syncState:{placeMatchingVersion:'a'.repeat(64)}},refetch}),[activities,userId]);}`,
        }));
      },
    },
  ],
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PlaceSearch} from '~/components/place-search';
import {store,useShallowStore} from '~/store';
import {useFilteredActivities} from '~/hooks/use-filtered-activities';import {BrowsingProvider,useBrowsingLibrary} from '~/hooks/use-browsing-library';
import {filterStatsActivities} from '~/lib/stats/filter-scope';
import {dtoToActivityWithPlaces} from '~/lib/sync/v1-mappers';
import {activityDTOSchema} from '~/contracts/v1/activity';
import fixture from './shared/place-library-fixtures.v1.json';
import base from './shared/sync-integrity-fixtures.v1.json';
const listeners=new Set();window.subscribeActivities=fn=>{listeners.add(fn);return ()=>listeners.delete(fn);};
window.fixtureDTOs=fixture.activities.map(row=>activityDTOSchema.parse({...base.activity,...row,placeMatches:row.placeMatches??null}));window.fixtureActivities=window.fixtureDTOs.map(dto=>dtoToActivityWithPlaces(dto,fixture.userId,fixture.matchingVersion));
window.fixtureState=store;store.getState().initializeAuth({currentUser:{id:'alice',stravaConnected:true}});store.setState({selected:[1,3]});
window.replacePlaces=()=>{window.fixtureDTOs=window.fixtureDTOs.map(a=>({...a,placeMatches:a.placeMatches?{...a.placeMatches,places:[]}:null}));window.fixtureActivities=window.fixtureDTOs.map(dto=>dtoToActivityWithPlaces(dto,fixture.userId,fixture.matchingVersion));for(const fn of listeners)fn();};
function App(){const s=useShallowStore(s=>s);const data=React.useSyncExternalStore(window.subscribeActivities,()=>window.fixtureActivities);const result=useFilteredActivities(data);return <main style={{padding:20,maxWidth:420}}>
<PlaceSearch/><p data-testid="ids">{result.filterIDs.join(',')}</p><p data-testid="stats">{filterStatsActivities(data,s).map(a=>a.id).join(',')}</p>
<button onClick={()=>s.resetFilters()}>Clear filters</button><button onClick={()=>store.setState({dateRange:{start:'2026-01-01',end:'2026-12-31'}})}>Year 2026</button>
<button onClick={()=>s.initializeAuth({currentUser:{id:'other',stravaConnected:true}})}>Other account</button>
</main>;}
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const root=createRoot(document.getElementById('root'));root.render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
window.typingCommits=[];window.resultRenders=0;
document.addEventListener('input',event=>{if(event.target.getAttribute('role')==='combobox'){window.rendersBeforeInput=window.resultRenders;window.lastInputEventAt=performance.now();}},true);
function HeavyResults(){const {filteredActivities,filterIDs}=useBrowsingLibrary();window.resultRenders++;React.useLayoutEffect(()=>{window.committedIDs=filterIDs;},[filterIDs]);return <section><p data-testid="perf-count">{filterIDs.length}</p>{filteredActivities.map(a=><div key={a.id}>{a.name}</div>)}</section>;}
function recordTyping(){const value=document.querySelector('[role=combobox]')?.value;if(value!==window.lastRecordedValue){window.lastRecordedValue=value;window.typingCommits.push({value,reusedResults:window.resultRenders===window.rendersBeforeInput,latencyMs:performance.now()-window.lastInputEventAt});}}
window.openPerformanceFixture=()=>{store.getState().initializeAuth({currentUser:{id:'alice',stravaConnected:true}});store.getState().resetFilters();const original=window.fixtureDTOs[0];window.fixtureDTOs=Array.from({length:10000},(_,i)=>({...original,id:String(i+1),name:'Activity '+i,placeMatches:{...original.placeMatches,activityId:String(i+1),places:[{id:'00000000-0000-4000-8000-'+String(i%2000).padStart(12,'0'),name:'Place '+(i%2000),kinds:['peak'],latitude:47,longitude:8,elevationM:1000,visits:[{distanceM:1}]}]}}));root.render(<QueryClientProvider client={client}><React.Profiler id="typing" onRender={recordTyping}><BrowsingProvider><PlaceSearch/><button onClick={()=>store.getState().resetFilters()}>Clear filters</button><HeavyResults/></BrowsingProvider></React.Profiler></QueryClientProvider>);};`,
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
const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
const errors = [],
  apiCalls = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname.startsWith('/api/'))
    apiCalls.push(request.url());
});
try {
  await page.goto('http://127.0.0.1:' + server.address().port);
  const input = page.getByRole('combobox');
  const expectIDs = async (expected) => {
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-testid="ids"]').textContent === text,
      expected,
    );
  };
  await input.focus();
  assert.equal(
    await page.getByRole('option').count(),
    0,
    'empty focus does not show hints',
  );
  await input.fill('   ');
  assert.equal(
    await page.getByRole('option').count(),
    0,
    'whitespace does not show hints',
  );
  await input.fill('Pilatus');
  await expectIDs('');
  assert.equal(
    await page.getByRole('option').count(),
    3,
    'name option plus two distinct place identities',
  );
  await input.press('ArrowDown');
  await input.press('Enter');
  await expectIDs('1,2');
  assert.equal(await input.inputValue(), '');
  assert.equal(
    await page.getByRole('option').count(),
    0,
    'choosing a place hides the empty-query hints',
  );
  const selectedPlace = await page.evaluate(
    () => window.fixtureState.getState().place,
  );
  await page.locator('main').evaluate((element) => {
    element.style.maxWidth = '296px';
  });
  await page.evaluate(
    (value) =>
      window.fixtureState.setState({
        place: {
          ...value,
          name: 'A very long mountain name that must stay inside the search field',
        },
      }),
    selectedPlace,
  );
  await input.fill('Morning');
  await expectIDs('1');
  await input.press('Escape');
  const fieldBounds = await page
    .getByTestId('place-search-field')
    .boundingBox();
  const tokenBounds = await page
    .getByTestId('selected-place-token')
    .boundingBox();
  const inputBounds = await input.boundingBox();
  assert.ok(
    tokenBounds.x >= fieldBounds.x &&
      tokenBounds.x + tokenBounds.width <= fieldBounds.x + fieldBounds.width,
    'a long token stays inside the narrow field',
  );
  assert.ok(
    Math.abs(
      tokenBounds.y +
        tokenBounds.height / 2 -
        inputBounds.y -
        inputBounds.height / 2,
    ) <= 1,
    'place token and input share one row',
  );
  assert.ok(
    inputBounds.width >= 40,
    'the activity-name input remains usable beside the pill',
  );
  await page.screenshot({ path: join(output, 'place-token-narrow.png') });
  await page.evaluate(
    (value) => window.fixtureState.setState({ place: value }),
    selectedPlace,
  );
  await page.locator('main').evaluate((element) => {
    element.style.maxWidth = '420px';
  });
  await page
    .getByRole('button', { name: 'Remove place filter: Pilátus', exact: true })
    .click();
  await expectIDs('1');
  assert.equal(await input.inputValue(), 'Morning');
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await page.getByRole('button', { name: 'Year 2026', exact: true }).click();
  await input.fill('Pilatus');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expectIDs('2');
  await page.reload();
  await expectIDs('2');
  assert.equal(
    await page
      .getByRole('button', {
        name: 'Place: Pilátus. View details',
        exact: true,
      })
      .count(),
    1,
    'place filter restores for the same account',
  );
  assert.equal(await page.getByTestId('stats').textContent(), '1,2');
  await page
    .getByRole('button', { name: 'Place: Pilátus. View details', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  const bounds = await dialog.boundingBox();
  assert.ok(
    bounds.x >= 0 && bounds.x + bounds.width <= 402,
    'place detail fits the phone viewport',
  );
  assert.match(await dialog.textContent(), /2 activities/);
  assert.match(await dialog.textContent(), /2025-05-01/);
  await page.screenshot({
    path: join(output, 'place-detail-phone.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.fixtureState.getState().selected),
    [1, 3],
  );
  await page
    .getByRole('button', { name: 'Place: Pilátus. View details', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Show activities', exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.destination), '/list');
  await page
    .getByRole('button', { name: 'Place: Pilátus. View details', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Show on map', exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.destination), '/map');
  assert.deepEqual(
    await page.evaluate(
      () => window.fixtureState.getState().routeFitRequest.activityIDs,
    ),
    [2],
  );
  await input.fill('Pilatus');
  await page.screenshot({ path: join(output, 'autocomplete-phone.png') });
  await input.press('Escape');
  await page.evaluate(() => window.replacePlaces());
  await expectIDs('');
  await page
    .getByText('No activities for this place.', { exact: false })
    .waitFor();
  await page
    .getByRole('button', { name: 'Other account', exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.fixtureState.getState().place),
    undefined,
  );
  await input.fill('Pilatus');
  assert.equal(
    await page.getByRole('option').count(),
    1,
    'old-account places are never suggested',
  );
  await page.evaluate(() => window.openPerformanceFixture());
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="perf-count"]')?.textContent ===
      '10000',
  );
  await input.pressSequentially('Activity 9999');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="perf-count"]').textContent === '1',
  );
  assert.equal(await input.inputValue(), 'Activity 9999');
  assert.deepEqual(await page.evaluate(() => window.committedIDs), [10000]);
  const typingCommits = await page.evaluate(() =>
    window.typingCommits.filter((entry) => entry.value),
  );
  assert.ok(typingCommits.length > 0);
  assert.ok(
    typingCommits.every((entry) => entry.reusedResults),
    'typing commits must not synchronously render the heavy result list',
  );
  await input.fill('Activity 12');
  await input.fill('Activity 5678');
  await page.waitForFunction(
    () => window.committedIDs?.length === 1 && window.committedIDs[0] === 5679,
  );
  await input.press('Escape');
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  assert.equal(await input.inputValue(), '');
  await page.waitForFunction(() => window.committedIDs?.length === 10000);
  console.log(
    '10000-activity typing: urgent commits reused results; max input commit ' +
      Math.max(...typingCommits.map((entry) => entry.latencyMs)).toFixed(1) +
      ' ms.',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(apiCalls, [], 'typing/filtering makes no API requests');
  await writeFile(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        passed: true,
        apiCalls: 0,
        checks: [
          'hints only after typing',
          'inline token with a long name in a narrow field',
          'text versus place',
          'keyboard choice',
          'duplicate names',
          'AND filters',
          'Stats history',
          'detail and navigation',
          'zero replacement',
          'account change',
          '10000-activity deferred typing and latest-query wins',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Place search browser journeys passed; no API requests.');
} catch (error) {
  console.error({ errors, apiCalls });
  await page.screenshot({ path: join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
