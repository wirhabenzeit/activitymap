// Render production detail primitives and real Tailwind styles without a backend.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('tsx/package.json'))] }));
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const repo = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'activity-detail-presentation-'));
await build({
  absWorkingDir: repo, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: join(directory, 'fixture.js'), alias: { '~': join(repo, 'src') },
  define: { 'process.env.NODE_ENV': '"development"' },
  stdin: { resolveDir: repo, loader: 'tsx', contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Bike } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '~/components/ui/card';
import { ActivityDetailStats } from '~/components/list/activity-detail-stats';
import { RouteDetailsContent } from '~/components/list/route-details-content';
import { ElevationPlot } from '~/components/list/elevation-plot';
const activity = { id:123, distance:182600, moving_time:22320, elapsed_time:25140, total_elevation_gain:1415,
 average_speed:8.17, max_speed:18, elev_low:406, elev_high:743, average_watts:206, max_watts:788,
 weighted_average_watts:254, kilojoules:4630, average_heartrate:120, max_heartrate:172, calories:2000,
 kudos_count:2, achievement_count:1, comment_count:0, photo_count:2, total_photo_count:4,
 commute:false, private:false, trainer:false, manual:false, flagged:false, geometryState:'detailed' };
const altitude = Array.from({length:90},(_,i)=>Math.round(560+100*Math.sin(i/12)+35*Math.sin(i/2)));
const profile = { distance:altitude.map((_,i)=>i*182600/89), altitude };
createRoot(document.getElementById('root')).render(
 <Card className="@container w-full border-none shadow-none">
  <CardHeader className="space-y-1 px-4 pb-3 pt-3">
   <div className="flex items-center gap-2">
    <Bike className="h-6 w-6 shrink-0" aria-hidden="true"/>
    <div><CardTitle className="text-base leading-5">Landsberg – Winterthur</CardTitle>
     <p className="mt-0.5 text-xs text-muted-foreground">Ride · 10 Aug 2020 · 09:12</p></div>
   </div>
  </CardHeader>
  <RouteDetailsContent elevation={<ElevationPlot profile={profile}/>} description="A long ride home through the hills.">
   <ActivityDetailStats activity={activity}><div data-testid="photos">Photo thumbnails</div></ActivityDetailStats>
  </RouteDetailsContent>
 </Card>);
` },
});
const cssPath = join(repo, 'src/styles/globals.css');
const styles = await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
await writeFile(join(directory, 'app.css'), styles.css);
await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><style>
body{font:14px system-ui;margin:0;background:hsl(var(--background));color:hsl(var(--foreground))}#root{max-width:860px;margin:auto}svg{display:block}
</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width:390, height:844 }, locale:'en-US' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.abort());
  await page.goto(`file://${join(directory, 'index.html')}`);
  for (const width of [390, 860]) {
    await page.setViewportSize({width,height:844});
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      const plot = page.getByRole('slider');
      await plot.waitFor();
      await plot.focus();
      await page.keyboard.press('End');
      await plot.evaluate(element => element.blur());
      const plotBounds = await plot.boundingBox();
      await page.mouse.move(plotBounds.x + plotBounds.width - 12, plotBounds.y + 75);
      const headline = page.locator('dl[aria-label="Activity summary"]');
      assert.deepEqual(await headline.locator('dt').allTextContents(), ['Distance','Moving time','Elevation gain']);
      assert.deepEqual(await headline.locator('dd').allTextContents(), ['182.6 km','6h 12m','1,415 m']);
      const tops = await headline.locator('dd').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().top));
      assert.ok(tops.every(top=>Math.abs(top-tops[0])<1), 'All three headline values share one row');
      const disclosure = page.locator('details');
      const toggle = page.getByText('Activity details', {exact:true});
      assert.equal(await disclosure.count(),1,'One disclosure for all secondary content');
      assert.equal(await disclosure.getAttribute('open'),null,'Details start collapsed');
      assert.equal(await page.locator('section').first().isVisible(),false,'Secondary stats start hidden');
      assert.equal(await page.getByTestId('photos').isVisible(),false,'Photos start hidden');
      const compactPath=join(directory,`activity-detail-collapsed-${width}-${theme}.png`);
      await page.screenshot({path:compactPath,fullPage:true});
      console.log(compactPath);
      await toggle.click();
      assert.equal(await page.getByTestId('photos').isVisible(),true,'Photos expand with secondary stats');
      const groups = page.locator('section');
      assert.deepEqual(await groups.locator('h3').allTextContents(), ['Time & speed','Elevation','Power','Heart rate','Energy','Social','Activity']);
      for (let i=0;i<await groups.count();i++) {
        assert.equal(await groups.nth(i).isVisible(),true,'One disclosure reveals every group');
        assert.equal(await groups.nth(i).locator('svg').count(),1,'One icon per topic group');
      }
      const ids = await page.locator('[data-stat]').evaluateAll(elements=>elements.map(element=>element.dataset.stat));
      assert.equal(ids.length,22);
      assert.equal(new Set(ids).size,ids.length,'Secondary fields appear once');
      assert.ok(!ids.some(id=>['distance','movingTime','elevationGain'].includes(id)),'Headlines are not repeated in groups');
      const geometry = await page.evaluate(()=>({viewport:innerWidth, width:document.documentElement.scrollWidth,
        groups:[...document.querySelectorAll('section')].map(element=>({x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y}))}));
      assert.ok(geometry.width<=geometry.viewport,'No horizontal overflow');
      if(width===390) assert.equal(geometry.groups[0].x,geometry.groups[1].x,'Phone groups stack');
      else assert.equal(geometry.groups[0].y,geometry.groups[1].y,'Wide cards show topic groups side by side');
      assert.ok((await headline.boundingBox()).y >= (await plot.boundingBox()).y + (await plot.boundingBox()).height,'Chart precedes headlines');
      const description = page.getByText('A long ride home through the hills.', {exact:true});
      assert.equal(await description.count(), 1);
      assert.ok((await description.boundingBox()).y + (await description.boundingBox()).height <= (await plot.boundingBox()).y, 'Description precedes chart');
      const path=join(directory,`activity-detail-${width}-${theme}.png`);
      await page.screenshot({path,fullPage:true});
      console.log(path);
      await toggle.click();
      assert.equal(await groups.first().isVisible(),false,'Secondary stats collapse again');
      assert.equal(await headline.isVisible(),true,'Headline stats stay visible');
      assert.equal(await plot.isVisible(),true,'Chart stays visible');
    }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: actual Tailwind styles, phone/wide light/dark, one headline row, one disclosure for groups/photos, no duplicate fields, no horizontal overflow.');
} finally { await browser.close(); }
