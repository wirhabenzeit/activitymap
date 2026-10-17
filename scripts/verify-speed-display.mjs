// Exercise production table columns, sorting, summaries and activity details
// with local fixtures; creates and removes only its own temporary Next route.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3102');
assert(['localhost', '127.0.0.1'].includes(base.hostname));
const route = resolve(import.meta.dirname, '../src/app/pace-verification');
const output = '/tmp/activitymap-pace-browser';
await mkdir(route);
await mkdir(output, { recursive: true });
let browser;
try {
  await writeFile(
    join(route, 'page.tsx'),
    `
'use client';
import { useMemo, useState } from 'react';
import { DataTable } from '~/components/list/data-table';
import { columns } from '~/components/list/columns';
import { ActivityDetailStats } from '~/components/list/activity-detail-stats';
import { setDisplayUnits } from '~/hooks/use-display-preferences';
import { dtoToActivity } from '~/lib/sync/v1-mappers';
import { activityDTOSchema } from '~/contracts/v1/activity';
import fixture from '../../../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json';
const defaults = Object.fromEntries(Object.keys(activityDTOSchema.shape).filter(key=>key!=='streams').map(key=>[key,null]));
const testColumns = columns.filter(c=>c.id==='id'||c.id==='average_speed').concat([{id:'name',accessorKey:'name',header:'Name',meta:{title:'Name',width:'200px'}}]);
export default function Review() {
  const [scenario,setScenario]=useState('mixed');
  const [runOnly,setRunOnly]=useState(false);
  const [sorting,setSorting]=useState([{id:'id',desc:false}]);
  const [visibility,setVisibility]=useState({id:false});
  const [selected,setSelected]=useState([]);
  const [density,setDensity]=useState('md');
  const [pinning,setPinning]=useState({start:[],end:[]});
  const [summary,setSummary]=useState('all');
  const data=useMemo(()=>Array.from({length:205},(_,i)=>dtoToActivity(activityDTOSchema.parse({...defaults,...fixture.activities[0],id:String(i+1),name:'Activity '+(i+1),sport_type:scenario==='swim'?'Swim':scenario==='mixed'&&i===204?'Ride':i%2?'TrailRun':'Run',average_speed:i===2?0:i===3?null:scenario==='swim'?1.25:i===1?2.5:10/3,max_speed:4}))),[scenario]);
  const filters=useMemo(()=>runOnly?[{id:'id',value:data.filter(a=>a.sport_type!=='Ride').map(a=>a.id)}]:[],[data,runOnly]);
  return <main style={{height:'100vh',display:'flex',flexDirection:'column',padding:16}}>
    <nav>{['mixed','run','swim'].map(s=><button key={s} onClick={()=>{setScenario(s);setRunOnly(false);setSorting([{id:'id',desc:false}])}}>{s}</button>)}
      <button onClick={()=>setDisplayUnits('metric')}>Metric</button><button onClick={()=>setDisplayUnits('imperial')}>Imperial</button>
      <button onClick={()=>setRunOnly(v=>!v)}>Filter runs</button>
    </nav>
    <div style={{height:440,display:'flex'}}><DataTable columns={testColumns} data={data} sorting={sorting} setSorting={setSorting}
      columnVisibility={visibility} setColumnVisibility={setVisibility} selected={selected} setSelected={setSelected}
      density={density} setDensity={setDensity} columnPinning={pinning} setColumnPinning={setPinning}
      summaryRow={summary} setSummaryRow={setSummary} columnFilters={filters} className="min-w-0 flex-1" /></div>
    <section data-testid="detail"><ActivityDetailStats activity={data[0]} /></section>
  </main>;
}
`,
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
    locale: 'en-US',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://**', (route) => route.abort());
  const response = await page.goto(new URL('/pace-verification', base).href, {
    timeout: 120000,
  });
  assert(response.ok(), `Fixture returned ${response.status()}`);
  const row = (id) => page.locator(`#table-main [data-activity-id="${id}"]`);
  await row(1).waitFor();
  await page.getByRole('button', { name: 'Metric', exact: true }).click();
  assert.match(await row(1).innerText(), /12\.0 km\/h/);
  assert.equal(
    await row(205).count(),
    0,
    'Mixed sport on another page still determines table units',
  );
  await page.getByRole('button', { name: 'Filter runs', exact: true }).click();
  await page
    .getByRole('button', { name: 'Sort by Average pace', exact: true })
    .waitFor();
  assert.match(await row(1).innerText(), /5:00 min\/km/);
  await page.getByRole('button', { name: 'run', exact: true }).click();
  assert.match(await row(2).innerText(), /6:40 min\/km/);
  assert.match(await row(3).innerText(), /—/);
  const sort = page.getByRole('button', {
    name: 'Sort by Average pace',
    exact: true,
  });
  await sort.click();
  await sort.click();
  const sorted = await page
    .locator('#table-main tbody tr[data-activity-id]')
    .first()
    .getAttribute('data-activity-id');
  assert.equal(
    sorted,
    '205',
    'Ascending pace sorts the faster tied runs first, with ID tie-break',
  );
  const detail = page.getByTestId('detail');
  assert.deepEqual(
    await detail
      .locator('dl[aria-label="Activity summary"] dt')
      .allTextContents(),
    ['Distance', 'Moving time', 'Average pace'],
  );
  assert.match(await detail.innerText(), /5:00 min\/km/);
  await page.getByRole('button', { name: 'Imperial', exact: true }).click();
  assert.match(await detail.innerText(), /8:03 min\/mi/);
  await page.getByRole('button', { name: 'swim', exact: true }).click();
  assert.match(await detail.innerText(), /1:13 min\/100 yd/);
  await page.getByRole('button', { name: 'Metric', exact: true }).click();
  assert.match(await detail.innerText(), /1:20 min\/100 m/);
  for (const width of [390, 834, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        dark,
      );
      assert.match(await row(1).innerText(), /1:20 min\/100 m/);
      await page.screenshot({
        path: join(output, `swim-${width}-${dark ? 'dark' : 'light'}.png`),
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Pace browser checks passed: mixed pagination, filtered scope, sorting, zero/missing, detail hierarchy, live units, swim/run, 3 widths and light/dark.',
  );
} finally {
  await browser?.close();
  await rm(route, { recursive: true, force: true });
  await rm(resolve(import.meta.dirname, '../.next/dev/types/app/pace-verification'), { recursive: true, force: true });
}
