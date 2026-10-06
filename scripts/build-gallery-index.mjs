// Build index.html for a gallery run, optionally beside a baseline run:
// node scripts/build-gallery-index.mjs <run-dir> [baseline-dir]
// Captures are review material only: there is no pass/fail. Images are
// referenced and lazy loaded by default; set ACTIVITYMAP_GALLERY_EMBED=1 for a portable HTML export.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const [runDir, baselineDir] = process.argv.slice(2);
if (!runDir) throw new Error('Pass a gallery run directory');

const read = (dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const stem = file.replace(/\.json$/, '');
      const image = [`${stem}.jpg`, `${stem}.png`].find((name) => existsSync(join(dir, name)));
      return { ...JSON.parse(readFileSync(join(dir, file), 'utf8')), stem, image, dir };
    })
    .filter((shot) => shot.image);
const embed = (shot) =>
  `data:image/${shot.image.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(join(shot.dir, shot.image)).toString('base64')}`;

const shots = read(runDir).map((s) => ({ ...s, platform: s.platform ?? 'ios' }));
const baseline = baselineDir && existsSync(baselineDir) ? new Map(read(baselineDir).map((s) => [s.stem, s])) : null;
const variantOrder = ['phone', 'phone-dark', 'phone-landscape', 'small-large-text', 'tablet', 'desktop'];
const variants = [...new Set(shots.map((s) => s.variant))].sort((a, b) => variantOrder.indexOf(a) - variantOrder.indexOf(b));
// Web screens join the native scene they correspond to; others get their own section.
const sceneOf = (s) => s.scene;
const native = shots.filter((s) => s.platform === 'ios').sort((a, b) => a.order - b.order);
const titles = new Map(native.map((s) => [sceneOf(s), s.title]));
for (const s of shots.filter((s) => s.platform === 'web')) if (!titles.has(sceneOf(s))) titles.set(sceneOf(s), s.title);
const scenes = [...titles];
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const meta = native[0] ?? shots[0] ?? {};
const web = shots.find((s) => s.platform === 'web');

const image = (shot, label, extra = '') =>
  `<div class="shot ${extra}"><img loading="lazy" decoding="async" class="${extra}" src="${process.env.ACTIVITYMAP_GALLERY_EMBED === '1' ? embed(shot) : relative(runDir, join(shot.dir, shot.image)).split('/').map(encodeURIComponent).join('/')}" alt="${escape(`${shot.title}, ${shot.variant}, ${label}`)}"><span>${label}</span></div>`;
const figure = (scene, variant) => {
  const group = shots.filter((s) => sceneOf(s) === scene && s.variant === variant);
  if (!group.length) return '';
  const ios = group.find((s) => s.platform === 'ios');
  const old = ios && baseline?.get(ios.stem);
  const webShot = group.find((s) => s.platform === 'web');
  const size = (ios ?? webShot);
  const warning = ios && webShot && (!ios.fixtureHash || !webShot.fixtureHash
    ? 'Legacy captures: shared fixture/state not verified'
    : ios.fixtureHash !== webShot.fixtureHash || JSON.stringify(ios.selectedIDs) !== JSON.stringify(webShot.selectedIDs) || (ios.detailID ?? null) !== (webShot.detailID ?? null) || (ios.search ?? '') !== (webShot.search ?? '')
      ? 'Not comparable: fixture or scenario state differs' : 'Shared fixture and activity state');
  const missing = (label) => `<div class="missing">${label}: no capture for this scenario</div>`;
  return `<figure data-variant="${escape(variant)}"${variant !== variants[0] ? ' hidden' : ''}><div class="pair">${old ? image(old, 'iOS baseline', 'baseline') : ''}${
    ios ? image(ios, 'iOS') : missing('iOS')}${webShot ? image(webShot, 'Web') : missing('Web')}</div>
    <figcaption>${escape(variant)} · ${size.width}×${size.height}${warning ? ` · ${escape(warning)}` : ''}${variant === 'small-large-text' ? ' · iOS Dynamic Type / web 150% text (different scaling systems)' : ''}</figcaption></figure>`;
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ActivityMap gallery · ${escape(basename(runDir))}</title>
<style>
:root { color-scheme: light dark; --bg: #f4f4f2; --fg: #1c1c1e; --muted: #6b6b70; --card: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #111113; --fg: #f2f2f4; --muted: #9a9aa0; --card: #1c1c1f; } }
body { margin: 0; padding: 16px 24px 64px; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, system-ui, sans-serif; }
header { position: sticky; top: 0; background: var(--bg); padding: 8px 0 12px; z-index: 1; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 12px; }
.meta, figcaption { color: var(--muted); font-size: 12px; }
nav label { margin-right: 12px; user-select: none; }
[hidden] { display: none !important; }
.missing { width: 260px; padding: 24px; background: var(--card); color: var(--muted); }
.shot.baseline { display: none; }
body.baselines .shot.baseline { display: block; }
.row { display: flex; gap: 20px; overflow-x: auto; align-items: flex-start; padding-bottom: 8px; }
figure { margin: 0; flex: none; }
.pair { display: flex; gap: 6px; align-items: flex-start; }
.shot span { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
img { display: block; max-height: var(--h, 560px); max-width: calc(var(--h, 560px) * 1.7); width: auto; border-radius: 12px; background: var(--card); box-shadow: 0 1px 3px #0003; cursor: zoom-in; }
img.baseline { opacity: .9; outline: 2px dashed var(--muted); outline-offset: -2px; }
img.zoom { position: fixed; inset: 2vh 0 0; margin: auto; max-height: 96vh; max-width: 96vw; z-index: 2; cursor: zoom-out; }
</style></head><body>
<header><h1>ActivityMap gallery · ${escape(basename(runDir))}${baseline ? ` <span class="meta">vs ${escape(basename(baselineDir))} (dashed = baseline)</span>` : ''}</h1>
<div class="meta">iOS library: ${escape(meta.library ?? '?')} · basemap: ${escape(meta.basemap ?? '?')}${web ? ` · web: ${escape(web.library)}` : ''} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>
<nav><label>Viewport <select id="variant">${variants.map((v) => `<option value="${escape(v)}">${escape(v)}</option>`).join('')}</select></label>${baseline ? '<label><input type="checkbox" id="baseline"> Show iOS baseline</label>' : ''}
<label>size <input type="range" min="240" max="900" value="560" id="size"></label></nav></header>
${scenes
  .map(([scene, title]) => `<section><h2>${escape(title)}</h2><div class="row">${variants
    .map((variant) => figure(scene, variant))
    .join('')}</div></section>`)
  .join('')}
<script>
document.getElementById('variant').addEventListener('change', (e) => {
  document.querySelectorAll('figure').forEach((f) => f.hidden = f.dataset.variant !== e.target.value);
  document.querySelectorAll('section').forEach((s) => s.hidden = !s.querySelector('figure:not([hidden])'));
});
document.getElementById('variant').dispatchEvent(new Event('change'));
document.getElementById('baseline')?.addEventListener('change', (e) => document.body.classList.toggle('baselines', e.target.checked));
document.getElementById('size').addEventListener('input', (e) => document.body.style.setProperty('--h', e.target.value + 'px'));
document.addEventListener('click', (e) => { if (e.target.tagName === 'IMG') e.target.classList.toggle('zoom'); });
</script></body></html>`;

writeFileSync(join(runDir, 'index.html'), html);
console.log(`Gallery: ${join(runDir, 'index.html')} (${shots.length} captures)`);
