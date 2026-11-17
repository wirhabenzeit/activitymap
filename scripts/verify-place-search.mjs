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
              ? `export const useRouter=()=>({push:url=>{window.destination=url;}});export const usePathname=()=>window.fixturePathname??'/map';`
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
import {HeaderSearchBar,HeaderSearchButton} from '~/components/layout/header-search';
import {TextPlaceFilterChips} from '~/components/text-place-filter-chips';
import {store,useShallowStore} from '~/store';
import {useHeaderSearch} from '~/store/header-search';
import {BrowsingProvider,useBrowsingLibrary} from '~/hooks/use-browsing-library';
import {filterByStatsSports} from '~/store/stats-scope';
import {dtoToActivityWithPlaces} from '~/lib/sync/v1-mappers';
import {activityDTOSchema} from '~/contracts/v1/activity';
import fixture from './shared/place-library-fixtures.v1.json';
import base from './shared/sync-integrity-fixtures.v1.json';
const listeners=new Set();window.subscribeActivities=fn=>{listeners.add(fn);return ()=>listeners.delete(fn);};
window.fixtureDTOs=fixture.activities.map(row=>activityDTOSchema.parse({...base.activity,...row,placeMatches:row.placeMatches??null}));
window.fixtureState=store;window.headerSearch=useHeaderSearch;store.getState().initializeAuth({currentUser:{id:'alice',stravaConnected:true}});store.setState({selected:[1,3]});
window.replacePlaces=()=>{window.fixtureDTOs=window.fixtureDTOs.map(a=>({...a,placeMatches:a.placeMatches?{...a.placeMatches,places:[]}:null}));for(const fn of listeners)fn();};
function Header(){const {active,begin}=useHeaderSearch();return <header data-testid="header" style={{position:'relative',display:'flex',alignItems:'center',height:56}} className="bg-header-background text-header-foreground px-2">{active?<HeaderSearchBar/>:<HeaderSearchButton onBegin={begin}/>}</header>;}
function Results(){const s=useShallowStore(s=>s);const {query:{data=[]},filterIDs}=useBrowsingLibrary();window.resultRenders++;React.useLayoutEffect(()=>{window.committedIDs=filterIDs;},[filterIDs]);return <section style={{padding:20}}><TextPlaceFilterChips/><p data-testid="ids">{filterIDs.join(',')}</p><p data-testid="stats">{filterByStatsSports(data,s.statsSports).map(a=>a.id).join(',')}</p>
<button onClick={()=>s.resetFilters()}>Clear filters</button><button onClick={()=>store.setState({dateRange:{start:'2026-01-01',end:'2026-12-31'}})}>Year 2026</button><button onClick={()=>store.setState({dateRange:{start:'2020-01-01',end:'2020-12-31'}})}>Year 2020</button>
<button onClick={()=>s.initializeAuth({currentUser:{id:'other',stravaConnected:true}})}>Other account</button></section>;}
function App(){return <main style={{maxWidth:520}}><Header/><Results/></main>;}
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const root=createRoot(document.getElementById('root'));
const render=()=>root.render(<QueryClientProvider client={client}><React.Profiler id="typing" onRender={recordTyping}><BrowsingProvider><App/></BrowsingProvider></React.Profiler></QueryClientProvider>);
window.typingCommits=[];window.resultRenders=0;
document.addEventListener('input',event=>{if(event.target.type==='search'){window.rendersBeforeInput=window.resultRenders;window.lastInputEventAt=performance.now();}},true);
function recordTyping(){const value=document.querySelector('input[type=search]')?.value;if(value!==window.lastRecordedValue){window.lastRecordedValue=value;window.typingCommits.push({value,reusedResults:window.resultRenders===window.rendersBeforeInput,latencyMs:performance.now()-window.lastInputEventAt});}}
render();
window.openPerformanceFixture=()=>{store.getState().initializeAuth({currentUser:{id:'alice',stravaConnected:true}});store.getState().resetFilters();const original=window.fixtureDTOs[0];window.fixtureDTOs=Array.from({length:10000},(_,i)=>({...original,id:String(i+1),name:'Activity '+i,placeMatches:{...original.placeMatches,activityId:String(i+1),places:[{id:'00000000-0000-4000-8000-'+String(i%2000).padStart(12,'0'),name:'Place '+(i%2000),kinds:['peak'],latitude:47,longitude:8,elevationM:1000,visits:[{distanceM:1}]}]}}));window.typingCommits=[];for(const fn of listeners)fn();};`,
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
  const PLACE = '00000000-0000-4000-8000-000000000001';
  // A searchbox until the results panel opens, then a combobox.
  const input = page.getByLabel('Find activities or places', { exact: true });
  const state = (key) =>
    page.evaluate((k) => window.fixtureState.getState()[k], key);
  const expectIDs = async (expected) => {
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-testid="ids"]').textContent === text,
      expected,
    );
  };
  const begin = async () => {
    await page.getByTestId('header-search-button').click();
    await input.waitFor();
  };
  const options = () => page.getByRole('option').count();

  // Opening: the button, `/` and ⌘K/Ctrl+K; Escape and Close end search.
  await expectIDs('1,2,3,4,5,6,7,8,9,10,11,12,13,14');
  await begin();
  assert.ok(
    await input.evaluate((el) => el === document.activeElement),
    'search opens focused',
  );
  assert.equal(await options(), 0, 'no panel before typing');
  await input.fill('   ');
  assert.equal(await options(), 0, 'whitespace shows no panel');
  await input.press('Escape');
  await page.getByTestId('header-search-button').waitFor();
  await page.keyboard.press('/');
  await input.waitFor();
  await page.getByTestId('header-search-close').click();
  await page.keyboard.press('ControlOrMeta+k');
  await input.waitFor();

  // Results: activities by name or visited place, places, then the filter row.
  await input.fill('Pilatus');
  await page.getByTestId('header-search-results').waitFor();
  assert.equal(
    await page.locator('[data-testid^="header-search-activity-"]').count(),
    3,
    'activities that visited Pilátus, never stale or other-account matches',
  );
  assert.equal(
    await page.locator('[data-testid^="header-search-place-"]').count(),
    2,
    'two distinct place identities',
  );
  assert.equal(await options(), 6, 'activities, places and the filter row');
  assert.match(
    await page.getByTestId('header-search-activity-1').textContent(),
    /via Pilátus/,
  );
  await expectIDs('1,2,3,4,5,6,7,8,9,10,11,12,13,14');
  assert.equal(await state('search'), '', 'typing never filters');
  await page.screenshot({
    path: join(output, 'header-search-phone.png'),
    animations: 'disabled',
  });

  // Picking a place selects what visited it, pins it and frames the routes.
  for (let i = 0; i < 4; i++) await input.press('ArrowDown');
  await input.press('Enter');
  await page.getByTestId('header-search-button').waitFor();
  assert.deepEqual([...(await state('selected'))].sort(), [1, 2]);
  assert.equal((await state('searchPlace'))?.id, PLACE);
  assert.deepEqual(
    [...(await state('routeFitRequest')).activityIDs].sort(),
    [1, 2],
  );
  assert.equal(await state('place'), undefined, 'picking never filters');
  assert.equal(await page.evaluate(() => window.destination), undefined);

  // Picking an activity replaces the selection and clears the place pin.
  await begin();
  await input.fill('Morning');
  await page.getByTestId('header-search-activity-1').click();
  assert.deepEqual(await state('selected'), [1]);
  assert.equal(await state('highlighted'), 1);
  assert.equal(await state('searchPlace'), null);

  // On Stats, a pick goes to the map.
  await page.evaluate(() => {
    window.fixturePathname = '/stats/tiles';
  });
  await begin();
  await input.fill('Morning');
  await page.getByTestId('header-search-activity-1').click();
  assert.equal(await page.evaluate(() => window.destination), '/map');
  await page.evaluate(() => {
    window.fixturePathname = '/map';
  });

  // Enter with nothing highlighted applies the text as the text filter.
  await begin();
  await input.fill('Pilatus');
  await page.getByTestId('header-search-apply-filter').waitFor();
  assert.match(
    await page.getByTestId('header-search-apply-filter').textContent(),
    /3 activities/,
  );
  await input.press('Enter');
  await expectIDs('1,2,3');
  assert.deepEqual(
    [...(await state('routeFitRequest')).activityIDs].sort(),
    [1, 2, 3],
    'the map fits the filtered routes',
  );
  await page
    .getByRole('button', { name: 'Remove text filter: Pilatus' })
    .waitFor();

  // With a text filter on, the panel offers to replace or clear it.
  await begin();
  await input.fill('Morning');
  assert.match(
    await page.getByTestId('header-search-apply-filter').textContent(),
    /1 activity · replaces “Pilatus”/,
  );
  await page.getByTestId('header-search-clear-filter').click();
  await expectIDs('1,2,3,4,5,6,7,8,9,10,11,12,13,14');
  await begin();
  await input.fill('Pilatus');
  assert.equal(
    await page.getByTestId('header-search-clear-filter').count(),
    0,
    'nothing to clear',
  );

  // Filter to a place from its row; the chip opens its details.
  await page.getByTestId(`header-search-filter-place-${PLACE}`).click();
  await expectIDs('1,2');
  assert.equal(await state('search'), '');
  await page.getByRole('button', { name: 'Year 2026', exact: true }).click();
  await expectIDs('2');
  await page.reload();
  await expectIDs('2');
  assert.equal(
    await page
      .getByRole('button', { name: 'Place: Pilátus. View details' })
      .count(),
    1,
    'place filter restores for the same account',
  );
  assert.equal(
    await page.getByTestId('stats').textContent(),
    await page.evaluate(() => window.fixtureDTOs.map((a) => a.id).join(',')),
  );
  await page
    .getByRole('button', { name: 'Place: Pilátus. View details' })
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
  await page
    .getByRole('button', { name: 'Place: Pilátus. View details' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Show on map', exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.destination), '/map');
  assert.deepEqual((await state('routeFitRequest')).activityIDs, [2]);
  await page
    .getByRole('button', { name: 'Remove place filter: Pilátus' })
    .click();

  // A place whose activities the filters hide: fly to the place itself.
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await page.getByRole('button', { name: 'Year 2020', exact: true }).click();
  await expectIDs('');
  await begin();
  await input.fill('Pilatus');
  await page.getByTestId(`header-search-place-${PLACE}`).click();
  assert.deepEqual(await state('selected'), []);
  assert.deepEqual(
    [
      (await state('placeFlyRequest'))?.latitude,
      (await state('placeFlyRequest'))?.longitude,
    ],
    [46.98, 8.25],
  );
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();

  // A place filter whose matches disappear stays visible and explains itself.
  await page.evaluate((id) => {
    window.fixtureState.setState({
      place: { id, name: 'Pilátus', userId: 'alice' },
    });
  }, PLACE);
  await page.evaluate(() => window.replacePlaces());
  await expectIDs('');
  await page
    .getByText('No activities for this place.', { exact: false })
    .waitFor();
  await page
    .getByRole('button', { name: 'Other account', exact: true })
    .click();
  assert.equal(await state('place'), undefined);
  await begin();
  await input.fill('Pilatus');
  assert.equal(
    await page.locator('[data-testid^="header-search-place-"]').count(),
    0,
    'old-account places are never suggested',
  );
  await input.press('Escape');

  // 10000 activities: typing never re-renders the filtered results, and the
  // latest query wins once applied.
  await page.evaluate(() => window.openPerformanceFixture());
  await page.waitForFunction(() => window.committedIDs?.length === 10000);
  await begin();
  await input.pressSequentially('Activity 9999');
  await page.getByTestId('header-search-activity-10000').waitFor();
  assert.equal(await input.inputValue(), 'Activity 9999');
  const typingCommits = await page.evaluate(() =>
    window.typingCommits.filter((entry) => entry.value),
  );
  assert.ok(typingCommits.length > 0);
  assert.ok(
    typingCommits.every((entry) => entry.reusedResults),
    'typing commits must not render the filtered results',
  );
  await input.fill('Activity 12');
  await input.fill('Activity 5678');
  await page.getByTestId('header-search-activity-5679').waitFor();
  await input.press('Enter');
  await page.waitForFunction(
    () => window.committedIDs?.length === 1 && window.committedIDs[0] === 5679,
  );
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await page.waitForFunction(() => window.committedIDs?.length === 10000);
  console.log(
    '10000-activity typing: urgent commits reused results; max input commit ' +
      Math.max(...typingCommits.map((entry) => entry.latencyMs)).toFixed(1) +
      ' ms.',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(apiCalls, [], 'searching/filtering makes no API requests');
  await writeFile(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        passed: true,
        apiCalls: 0,
        checks: [
          'opens by button, / and Cmd/Ctrl+K; Escape and Close end it',
          'no panel before typing',
          'activities by name or visited place, places, filter row',
          'place pick selects, pins and fits',
          'activity pick selects and clears the pin',
          'Stats pick goes to the map',
          'Enter applies the text filter and fits',
          'replace or clear an existing text filter',
          'filter to a place; chip, detail and navigation',
          'hidden place flies to the place',
          'zero replacement',
          'account change',
          '10000-activity deferred typing and latest-query wins',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Header search browser journeys passed; no API requests.');
} catch (error) {
  console.error({ errors, apiCalls });
  await page.screenshot({ path: join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
