// Fixture-only regression: no account, network, or Strava writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { launchBrowser } from './quality/browser-support.mjs';

const require = createRequire(process.cwd() + '/package.json');
const { build } = require(
  require.resolve('esbuild', { paths: [require.resolve('tsx')] }),
);

const store = `import {useSyncExternalStore} from 'react';
let state; const listeners=new Set();
export const update=(next)=>{state=next;listeners.forEach(fn=>fn());};
export const current=()=>state;
export const useStateSnapshot=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},current);
export const useShallowStore=selector=>selector(useStateSnapshot());
useShallowStore.getState=current;
`;
const mocks = {
  '~/store': store,
  '~/hooks/use-activities': `import {useStateSnapshot} from '~/store'; export const useActivities=()=>({data:useStateSnapshot().library});`,
  '~/hooks/use-photos': 'export const usePhotos=()=>({data:[]});',
  '~/hooks/use-display-preferences': `export const useDateFormat=()=> 'system'; export const useDisplayUnits=()=> 'metric';`,
  '~/lib/activity-mutation-availability':
    'export const activityMutationAvailability=()=>({canEdit:true});',
  '~/lib/activity-merge/client': `export class MergeRequestError extends Error{}; export const STRAVA_UPLOAD_URL='https://example.invalid/upload'; export const stravaActivityUrl=id=>'https://example.invalid/activity/'+id; export const downloadMergedFile=async()=>{}; export const mergeActivitiesOnStrava=async()=>({upload_id:'900',status:'ready',activity_id:'555',error:null,duplicate_of:null,metadata_applied:true});`,
};
const result = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {MergeActivitiesProvider,SelectionMergeButton} from './src/components/merge/merge-activities-dialog';
import {update,current,useStateSnapshot} from '~/store';
const part=(id,minute)=>({id,name:'Part '+id,description:'',sport_type:'Ride',start_date:new Date('2026-11-01T10:0'+minute+':00Z'),start_date_local:new Date('2026-11-01T10:0'+minute+':00Z'),elapsed_time:60,moving_time:60,distance:100,total_elevation_gain:10,manual:false,trainer:false,map_summary_polyline:'abc',private:false});
update({user:{id:'u1',features:{activityMerge:true}},isGuest:false,selected:[1,2],combineSelections:true,library:[part(1,0),part(2,2)]});
window.deleteOriginal=id=>{const s=current();update({...s,selected:s.selected.filter(x=>x!==id),library:s.library.filter(x=>x.id!==id)});};
window.setAdmin=enabled=>{const s=current();update({...s,user:{...s.user,features:{activityMerge:enabled}}});};
function Toolbar(){const s=useStateSnapshot();return s.library.length>0?<SelectionMergeButton activities={s.library}/>:null;}
createRoot(document.getElementById('root')).render(<MergeActivitiesProvider><Toolbar/></MergeActivitiesProvider>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [
    {
      name: 'fixture-mocks',
      setup(b) {
        b.onResolve({ filter: /^~\// }, (args) =>
          mocks[args.path]
            ? { path: args.path, namespace: 'fixture' }
            : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: mocks[args.path],
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page
    .getByRole('button', { name: 'Merge 2 selected activities', exact: true })
    .waitFor();
  await page.evaluate(() => window.setAdmin(false));
  assert.equal(
    await page
      .getByRole('button', { name: 'Merge 2 selected activities', exact: true })
      .count(),
    0,
  );
  await page.evaluate(() => window.setAdmin(true));
  await page
    .getByRole('button', { name: 'Merge 2 selected activities', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Merge on Strava', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Merged activity created', exact: true })
    .waitFor();
  await page.evaluate(() => window.deleteOriginal(1));
  await page
    .getByRole('dialog')
    .getByText('1 of 2 originals still on Strava.', { exact: true })
    .waitFor();
  await page.evaluate(() => window.deleteOriginal(2));
  await page
    .getByRole('dialog')
    .getByText('All originals are deleted.', { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('dialog')
      .getByText('Deleted', { exact: true })
      .count(),
    2,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: cleanup survives both deletions and removal of its toolbar; closes explicitly without errors.',
  );
} finally {
  await browser.close();
}
