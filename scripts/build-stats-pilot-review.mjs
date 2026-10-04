// Build a portable review: original vs pilot, plus volume groupings on both fixtures.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [pilot, dense, baseline] = process.argv.slice(2);
assert(pilot && dense && baseline, 'Pass pilot, dense and original capture directories');
const escape = (s) => s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function shot(dir, platform, tile, state, label) {
  const stem = `${platform}-${tile}-${state}`;
  const meta = JSON.parse(readFileSync(join(dir, stem + '.json')));
  const counterpart = JSON.parse(readFileSync(join(dir, `${platform === 'web' ? 'ios' : 'web'}-${tile}-${state}.json`)));
  for(const key of ['fixtureHash','today','option','width']) assert.equal(meta[key], counterpart[key]);
  const png = readFileSync(join(dir, stem + '.png'));
  return `<figure><figcaption>${escape(label)}<small>${meta.width} × ${Math.round(meta.height)}</small></figcaption><img loading="lazy" width="${meta.width}" height="${meta.height}" alt="${escape(label)}" src="data:image/png;base64,${png.toString('base64')}"></figure>`;
}
function variants(dir) {
  return ['expanded', 'expanded-months', 'expanded-years'].map((state, index) => {
    const label = ['By week', 'By month', 'By year'][index];
    return `<h3>${label}</h3><div class="grid">${shot(dir,'web','weeklyVolume',state,'Web · '+label)}${shot(dir,'ios','weeklyVolume',state,'iOS · '+label)}</div>`;
  }).join('');
}

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stats pilot · This week & Training volume</title>
<style>*{box-sizing:border-box}body{font:15px/1.5 system-ui;background:#f3f4f6;color:#182234;margin:0;padding:24px}header,section{max-width:1640px;margin:0 auto 40px}h1{font-size:28px}h2{font-size:22px}p{max-width:1100px;color:#526079}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start}figure{margin:0}figcaption{font-weight:650;margin-bottom:8px}small{display:block;color:#667080;font-weight:400}img{width:100%;height:auto;border-radius:8px;box-shadow:0 1px 6px #18223420;cursor:zoom-in}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#174a9c}dialog{border:0;border-radius:12px;max-height:95vh;max-width:95vw;overflow:auto}dialog img{width:378px;max-width:85vw;box-shadow:none}dialog button{display:block;margin:0 0 12px auto;padding:8px 16px}dialog::backdrop{background:#000b}@media(max-width:1000px){.grid{grid-template-columns:repeat(4,280px);overflow-x:auto;padding-bottom:12px}}</style>
<header><h1>Stats pilot: This week & Training volume</h1><p>Two overview candidates, followed by an expanded grouping comparison. Cards have matching 378-point/CSS-pixel widths; their natural heights are preserved. All captures use 22 September 2026. Click an image for 1× inspection.</p><p>The original 20-activity fixture provides the before/after. A separate, deterministic 60-activity synthetic history exercises denser sport layers. Both platforms use stacked areas with By week (last 12 weeks), By month (last 12 months), and By year (all available years). Grouping is available when expanded; earlier-period paging is deferred. The expanded total is labelled for its displayed range; it is distinct from the overview’s last-28-day total.</p><nav><a href="#thisWeek">This week</a><a href="#weeklyVolume">Volume overview</a><a href="#dense">Dense groupings</a><a href="#sparse">Sparse groupings</a><a href="index.html">All tiles</a></nav></header>
${[['thisWeek','This week'],['weeklyVolume','Training volume']].map(([id,title])=>`<section id="${id}"><h2>${title} · collapsed</h2><div class="grid">${shot(baseline,'web',id,'collapsed','Web · before')}${shot(baseline,'ios',id,'collapsed','iOS · before')}${shot(pilot,'web',id,'collapsed','Web · pilot')}${shot(pilot,'ios',id,'collapsed','iOS · pilot')}</div></section>`).join('')}
<section id="dense"><h2>Training volume · dense mixed-sport history</h2><p>Matched sport totals for each grouping. The weekly view has a full-week four-week average. The latest period is incomplete.</p>${variants(dense)}</section>
<section id="sparse"><h2>Training volume · sparse history</h2><p>The original fixture exposes how each grouping treats empty periods and isolated activity spikes.</p>${variants(pilot)}</section>
<dialog><button>Close</button><img alt=""></dialog><script>const d=document.querySelector('dialog');document.querySelectorAll('figure img').forEach(i=>i.onclick=()=>{const z=d.querySelector('img');z.src=i.src;z.alt=i.alt;d.showModal()});d.querySelector('button').onclick=()=>d.close();d.onclick=e=>{if(e.target===d)d.close()};</script></html>`;
writeFileSync(join(pilot,'pilot.html'),html);
console.log(`Wrote ${join(pilot,'pilot.html')}`);
