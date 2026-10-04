// Verify matching inputs and emit a portable, self-contained comparison report.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [output] = process.argv.slice(2);
assert(output, 'Pass the capture directory');
const repo = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(repo, 'shared/stats-capabilities.v1.json')));
const tiles = manifest.tiles.filter((tile) => tile.visibility === 'visible');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let reference;
let count = 0;
const notes = {
  weeklyVolume: 'Both use stacked areas with By week (last 12), By month (last 12), and By year (all available years). Earlier-period paging is deferred.',
  monthVsLastMonth: 'Both retain the current month versus the previous month; expansion adds chart space and inspection.',
  yearToDate: 'Both retain the current year versus the previous year; expansion adds chart space and inspection.',
  records: 'Compare the record categories and activity links: expanded parity is still part of #264.',
  activityCalendar: 'Web has historical calendar navigation. iOS currently expands its rolling calendar and day inspection.',
};
const columns = [
  ['web', 'collapsed', 'Web · collapsed'], ['ios', 'collapsed', 'iOS · collapsed'],
  ['web', 'expanded', 'Web · expanded'], ['ios', 'expanded', 'iOS · expanded'],
];
const sections = tiles.map((tile) => {
  let title = tile.id;
  const cells = columns.map(([platform, state, label]) => {
    if (state === 'expanded' && !tile.expandable) return '<div class="missing">No expanded state</div>';
    const stem = `${platform}-${tile.id}-${state}`;
    const meta = JSON.parse(readFileSync(join(output, `${stem}.json`)));
    assert.equal(meta.tile, tile.id); assert.equal(meta.platform, platform); assert.equal(meta.state, state);
    reference ??= meta;
    for (const key of ['fixtureHash', 'today', 'activityCount', 'width', 'scale']) {
      assert.equal(meta[key], reference[key], `${stem}: ${key} differs`);
    }
    assert.equal(meta.option, tile.defaultOption ?? 'none', `${stem}: option differs`);
    title = meta.title;
    const png = readFileSync(join(output, `${stem}.png`));
    assert.equal(png.readUInt32BE(16), Math.round(meta.width * meta.scale), `${stem}: image width`);
    assert(Math.abs(png.readUInt32BE(20) - meta.height * meta.scale) <= 2, `${stem}: image height`);
    count++;
    return `<figure><figcaption>${escape(label)} <small>${meta.width} × ${Math.round(meta.height)}</small></figcaption><img loading="lazy" width="${meta.width}" height="${meta.height}" src="data:image/png;base64,${png.toString('base64')}" alt="${escape(`${title}, ${label}`)}"></figure>`;
  }).join('');
  return { id: tile.id, title, html: `<section id="${tile.id}"><h2>${escape(title)}</h2>${notes[tile.id] ? `<p class="note">${escape(notes[tile.id])}</p>` : ''}<div class="grid">${cells}</div></section>` };
});
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stats tile comparison · Web / iOS</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:75px}body{margin:0;background:#f3f4f6;color:#172033;font:15px/1.5 system-ui,sans-serif}header,main{padding:24px;max-width:1680px;margin:auto}h1{margin:0 0 8px;font-size:28px}p{max-width:1100px}nav{position:sticky;top:0;z-index:2;display:flex;gap:8px;padding:12px 24px;overflow:auto;background:#172033}nav a{white-space:nowrap;color:#fff;text-decoration:none;font-size:13px;padding:4px 9px;border-radius:6px;background:#ffffff18}section{margin:0 0 40px}h2{margin:0 0 8px;font-size:22px}.note{color:#526079;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start}figure{margin:0;min-width:0}figcaption{font-weight:650;margin-bottom:8px}small{display:block;font-weight:400;color:#657086}img{display:block;width:100%;height:auto;border-radius:8px;box-shadow:0 1px 6px #17203320;cursor:zoom-in}.missing{padding:32px 12px;background:#e8ebef;color:#687285;text-align:center;border-radius:8px}.meta{color:#526079;font-size:13px}dialog{max-width:96vw;max-height:96vh;border:0;border-radius:12px;padding:18px;overflow:auto}dialog::backdrop{background:#000b}dialog img{width:378px;max-width:85vw;box-shadow:none}dialog button{display:block;margin:0 0 12px auto;padding:8px 16px}footer{padding:24px;color:#657086}@media(max-width:1000px){.grid{grid-template-columns:repeat(4,280px);overflow-x:auto;padding-bottom:12px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
<header><h1>Stats: Web / iOS</h1><p>Every visible tile, collapsed and expanded. Matching default choices, ${reference.activityCount} curated fixture activities, reporting date <strong>${escape(reference.today)}</strong>, light appearance and a <strong>378-point / CSS-pixel tile width</strong>. Images preserve each platform’s actual content height.</p><p class="meta">${count} screenshots · 11 tiles · 3 tiles have no expansion · 2× capture resolution · de-CH / Europe–Zurich<br>Web: real dashboard element captures. iOS: production SwiftUI tiles hosted individually at the dashboard’s phone width (402pt screen). Web uses a 450px viewport to allow for its wider shell padding; card widths match without modifying tile styles. This compares tile content and styling; it does not certify full-screen layout, transitions or device behavior. The reporting date is fixed near the fixture’s latest activity, not today. Click an image to inspect it at 1× logical size.</p></header>
<nav aria-label="Tiles">${sections.map((s) => `<a href="#${s.id}">${escape(s.title)}</a>`).join('')}</nav><main>${sections.map((s) => s.html).join('')}</main>
<dialog><button type="button">Close</button><img alt=""></dialog><script>const dialog=document.querySelector('dialog');document.querySelectorAll('figure img').forEach(img=>img.addEventListener('click',()=>{const zoom=dialog.querySelector('img');zoom.src=img.src;zoom.alt=img.alt;dialog.showModal()}));dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close()};</script>
<footer>Fixture SHA-256: ${escape(reference.fixtureHash)}. Generated locally from the current working tree. Expanded history/drill-down gaps are tracked in #264; visual alignment in #265.</footer></html>`;
writeFileSync(join(output, 'index.html'), html);
console.log(`Verified ${count} matched captures; wrote ${join(output, 'index.html')}`);
