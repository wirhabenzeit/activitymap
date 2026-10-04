// Verify matching inputs and emit a portable, self-contained comparison report.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [output] = process.argv.slice(2);
assert(output, 'Pass the capture directory');
const repo = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(repo, 'shared/stats-capabilities.v1.json')));
const catalogue = JSON.parse(readFileSync(join(repo, 'shared/stats-tiles.json')));
const tiles = catalogue.tiles.map((tile) => manifest.tiles.find((entry) => entry.id === tile.id)).filter((tile) => tile?.visibility === 'visible');
const run = existsSync(join(output, 'run.json')) ? JSON.parse(readFileSync(join(output, 'run.json'))) : {};
const resolutions = new Map();
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let reference;
let count = 0;
const notes = {
  weeklyVolume: 'Both use stacked areas with By week (last 12), By month (last 12), and By year (all available years). Earlier-period paging is deferred.',
  monthVsLastMonth: 'Both retain the current month versus the previous month; expansion adds chart space and inspection.',
  yearToDate: 'Both retain the current year versus the previous year; expansion adds chart space and inspection.',
  records: 'Both show record sport/date context; expansion adds record activity details and Best 30 days.',
  activityCalendar: 'Both support calendar-year navigation, inline day details and selected-day highlighting.',
};
const columns = [
  ['web', 'collapsed', 'Web · collapsed'], ['ios', 'collapsed', 'iOS · collapsed'],
  ['web', 'expanded', 'Web · expanded'], ['ios', 'expanded', 'iOS · expanded'],
];
// Native exports PNG; browser capture may provide JPEG. Validate actual pixels
// against each capture's scale, while requiring identical logical card widths.
function dimensions(bytes, format) {
  if (format === 'png') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Expected JPEG');
  for (let offset = 2; offset + 9 < bytes.length;) {
    const marker = bytes.readUInt16BE(offset);
    offset += 2;
    if ([0xffc0, 0xffc1, 0xffc2].includes(marker)) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    const size = bytes.readUInt16BE(offset);
    assert(size >= 2, 'Invalid JPEG segment');
    offset += size;
  }
  throw new Error('Missing JPEG dimensions');
}
function shot(tile, platform, state, label) {
  if (state === 'expanded' && !tile.expandable) return '<div class="missing">No expanded state</div>';
  const stem = `${platform}-${tile.id}-${state}`;
  const meta = JSON.parse(readFileSync(join(output, `${stem}.json`)));
  assert.equal(meta.tile, tile.id); assert.equal(meta.platform, platform); assert.equal(meta.state, state);
  reference ??= meta;
  for (const key of ['fixtureHash', 'today', 'activityCount', 'width']) {
    assert.equal(meta[key], reference[key], `${stem}: ${key} differs`);
  }
  assert.equal(meta.option, tile.defaultOption ?? 'none', `${stem}: option differs`);
  const format = meta.format ?? 'png';
  assert(['png', 'jpeg'].includes(format));
  assert(meta.scale > 0);
  if (resolutions.has(platform)) assert.equal(resolutions.get(platform), meta.scale);
  resolutions.set(platform, meta.scale);
  const bytes = readFileSync(join(output, `${stem}.${format === 'jpeg' ? 'jpg' : 'png'}`));
  const [width, height] = dimensions(bytes, format);
  assert.equal(width, Math.round(meta.width * meta.scale), `${stem}: image width`);
  assert(Math.abs(height - meta.height * meta.scale) <= 2, `${stem}: image height`);
  count++;
  return `<figure><figcaption>${escape(label)} <small>${meta.width} × ${Math.round(meta.height)}</small></figcaption><img loading="lazy" width="${meta.width}" height="${meta.height}" src="data:image/${format};base64,${bytes.toString('base64')}" alt="${escape(`${meta.title}, ${label}`)}"></figure>`;
}
const sections = tiles.map((tile) => {
  const title = JSON.parse(readFileSync(join(output, `ios-${tile.id}-collapsed.json`))).title;
  const cells = columns.map(([platform, state, label]) => shot(tile, platform, state, label)).join('');
  const groupings = tile.id === 'weeklyVolume' ? `<h3>Monthly and yearly detail</h3><div class="grid">${[
    ['web', 'expanded-months', 'Web · By month'], ['ios', 'expanded-months', 'iOS · By month'],
    ['web', 'expanded-years', 'Web · By year'], ['ios', 'expanded-years', 'iOS · By year'],
  ].map(([platform, state, label]) => shot(tile, platform, state, label)).join('')}</div>` : '';
  return { id: tile.id, title, html: `<section id="${tile.id}"><h2>${escape(title)}</h2>${notes[tile.id] ? `<p class="note">${escape(notes[tile.id])}</p>` : ''}<div class="grid">${cells}</div>${groupings}</section>` };
});
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stats tile comparison · Web / iOS</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:75px}body{margin:0;background:#f3f4f6;color:#172033;font:15px/1.5 system-ui,sans-serif}header,main{padding:24px;max-width:1680px;margin:auto}h1{margin:0 0 8px;font-size:28px}p{max-width:1100px}nav{position:sticky;top:0;z-index:2;display:flex;gap:8px;padding:12px 24px;overflow:auto;background:#172033}nav a{white-space:nowrap;color:#fff;text-decoration:none;font-size:13px;padding:4px 9px;border-radius:6px;background:#ffffff18}section{margin:0 0 40px}h2{margin:0 0 8px;font-size:22px}.note{color:#526079;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start}figure{margin:0;min-width:0}figcaption{font-weight:650;margin-bottom:8px}small{display:block;font-weight:400;color:#657086}img{display:block;width:100%;height:auto;border-radius:8px;box-shadow:0 1px 6px #17203320;cursor:zoom-in}.missing{padding:32px 12px;background:#e8ebef;color:#687285;text-align:center;border-radius:8px}.meta{color:#526079;font-size:13px}dialog{max-width:96vw;max-height:96vh;border:0;border-radius:12px;padding:18px;overflow:auto}dialog::backdrop{background:#000b}dialog img{width:378px;max-width:85vw;box-shadow:none}dialog button{display:block;margin:0 0 12px auto;padding:8px 16px}footer{padding:24px;color:#657086}@media(max-width:1000px){.grid{grid-template-columns:repeat(4,280px);overflow-x:auto;padding-bottom:12px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
<header><h1>Stats: Web / iOS</h1><p>Every visible tile, collapsed and expanded. Matching default choices, ${reference.activityCount.toLocaleString('en')} activities from ${escape(run.sourceLabel ?? 'the capture fixture')}, reporting date <strong>${escape(reference.today)}</strong>, light appearance and a <strong>378-point / CSS-pixel tile width</strong>. Images preserve each platform’s actual content height.</p><p class="meta">${count} screenshots · ${tiles.length} tiles · ${tiles.filter(tile => !tile.expandable).length} tiles have no expansion · ${[...resolutions].map(([platform, scale]) => `${platform === 'ios' ? 'iOS' : 'Web'} ${scale}×`).join(' / ')} capture resolution · de-CH / Europe–Zurich<br>Web: real dashboard element captures. iOS: production SwiftUI tiles hosted individually at the dashboard’s phone width (402pt screen). Web uses a 450px viewport to allow for its wider shell padding; card widths match without modifying tile styles. This compares tile content and styling; it does not certify full-screen layout, transitions or device behavior. Both platforms use the same fixed reporting date shown above. Click an image to inspect it at 1× logical size.</p></header>
<nav aria-label="Tiles">${sections.map((s) => `<a href="#${s.id}">${escape(s.title)}</a>`).join('')}</nav><main>${sections.map((s) => s.html).join('')}</main>
<dialog><button type="button">Close</button><img alt=""></dialog><script>const dialog=document.querySelector('dialog');document.querySelectorAll('figure img').forEach(img=>img.addEventListener('click',()=>{const zoom=dialog.querySelector('img');zoom.src=img.src;zoom.alt=img.alt;dialog.showModal()}));dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close()};</script>
<footer>Fixture SHA-256: ${escape(reference.fixtureHash)}. Generated locally from the current working tree. Current default states, plus all Training volume groupings. Full-library captures remain local and are not committed.</footer></html>`;
writeFileSync(join(output, 'index.html'), html);
console.log(`Verified ${count} matched captures; wrote ${join(output, 'index.html')}`);
