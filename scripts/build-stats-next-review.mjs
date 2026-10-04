// Annotated review of the nine tiles following the This week / Volume pilot.
// Usage: node scripts/build-stats-next-review.mjs <web-captures> <ios-captures>
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [web, ios] = process.argv.slice(2);
assert(web && ios, 'Pass web and iOS capture directories');
const reviews = [
  {
    id: 'monthVsLastMonth', title: 'This month', batch: 1,
    web: 'The inline value, short comparison and direct Sep / Aug curve labels are clearer. Historical month navigation shifts the focus away from the current month. The collapsed plot is too shallow; the previous-month line changes style in detail.',
    ios: 'The plot has useful height and a magnitude scale. Separate rows for period, picker, value and unit consume too much space. Current / Previous is vague, and a day-zero tick is unnatural. Expansion mostly makes the chart bigger.',
    choice: 'Use the compact header, 155 km so far, and +137 km · +746% vs Aug 1–22. Give the overview about 110–120pt of plot, a quiet scale and real day-of-month ticks. Label both curves with month names; keep the previous month dashed in both states.',
    detail: 'Keep the full previous-month curve for context, with the numerical comparison tied to the same elapsed days. Expanded: a larger version of that same current-month comparison, with richer inspection and no historical month navigator. No generic History & details heading.',
    decision: 'Current month stays fixed; compare with the previous month through equivalent elapsed days. No period selector for now. A future comparison choice would change only the reference, not the current month.',
  },
  {
    id: 'yearToDate', title: 'Year to date', batch: 1,
    web: 'Actual year labels and concise delta wording are strong. The collapsed tile is disproportionately tall. Automatically adding several similar grey curves creates clutter; historical navigation shifts the focus away from the current year.',
    ios: 'The y-scale helps read magnitude and the two-year comparison stays focused. Arbitrary ticks such as 10 Apr / 19 Jul are less useful than calendar months. “Last year by 22 Sep 2026” mixes the reference year and reporting date.',
    choice: 'Use the same card family as This month: 238 km so far, +186 km · +354% vs 2025 by Sep 22, about 110–120pt of plot, Jan / Apr / Jul / Oct ticks and direct 2026 / 2025 labels. Remove the web’s oversized collapsed span.',
    detail: 'Expanded: the current year versus the previous year, with a larger plot and richer inspection. No historical year navigation or comparison selector for now. Keep the same elapsed-calendar-date comparison; do not connect or project the unfinished current year.',
    decision: 'Current year stays fixed; compare with last year through equivalent elapsed calendar dates. If additional comparison years prove useful later, change only the reference while keeping the current year visible.',
  },
  {
    id: 'consistency', title: 'Consistency', batch: 2,
    web: 'The 12 / 52-week choice is visible and weekly bars have sensible width. The collapsed plot is too short. The repeated partial-week footer makes the summary heavier.',
    ios: 'The fixed 0–7 scale and chart height are useful. Bars become needles on a continuous date axis and tick dates do not clearly identify weeks. The shared native segmented picker is now in place.',
    choice: 'Keep 0.5 active days / week with Average over 11 full weeks. Use categorical weekly bars, a 110pt overview plot, actual week-start labels and a quiet 0–7 scale. Keep the range choice available in both states.',
    detail: 'Expanded: more space and touch inspection, especially for 52 weeks. Fade the current week and identify it on inspection/accessibility; remove the visible incomplete-week sentence. Do not add a duplicate visible counts table.',
    decision: 'Recommended: retain the denominator note—it explains why the current week is excluded from the average.',
  },
  {
    id: 'distanceVsElevation', title: 'Hilliness', batch: 2,
    web: 'Wide monthly bars and the hilliest-activities list are useful. Single-letter months can be ambiguous, the plot is short, and green deltas imply that more climbing is necessarily better. The expanded phone table is cramped.',
    ios: 'The scale and plot height aid reading. Narrow bars and arbitrary date ticks obscure the monthly grouping. Expansion does not yet add the activity list.',
    choice: 'Use categorical monthly bars, readable month names and a restrained scale with explicit m / 100 km units. Keep the comparison neutral in colour. Give the collapsed chart about 110pt of height.',
    detail: 'Expanded: a larger chart plus the five hilliest qualifying activities, retaining the ≥5 km rule. Use linked, labelled rows on phones and a table where width allows. Keep year context visible across the rolling-year boundary.',
    decision: 'Recommended: treat this as a description of terrain, not a performance score.',
  },
  {
    id: 'sportMix', title: 'Sport mix', batch: 3,
    web: 'The stacked share bar communicates part-to-whole quickly. The compact legend names only three of five sports. The expanded table packs too many columns into a phone card; its tiny per-row bars add little.',
    ios: 'Every sport has a readable name, share and colour. Expanded rows are more legible on a phone. Separate large progress bars and the split headline make both states much taller than necessary.',
    choice: 'Keep 37% Trail / Hike, of 29 h moving time, one stacked share bar and a complete wrapping legend. Use the existing This year / All time choice. Do not leave any coloured segment unnamed.',
    detail: 'Expanded: compact sport rows with share, moving time, count, distance and climb. Use aligned secondary values on phones and a table on wider screens. Remove repeated progress bars; keep colours and sport names consistent.',
    decision: 'Recommended: one visual for the proportions, then readable numbers for detail. Layout can adapt without changing the information.',
  },
  {
    id: 'yearPace', title: 'Year-end projection', batch: 3,
    web: 'The projected-total headline and simple reference bar give this tile a clear purpose. Compact supporting figures work well. The bar needs explicit labels so it is not mistaken for a target.',
    ios: 'Supporting values are clearly labelled. The presentation is mostly a tall list, and the daily rate rounds the fixture’s 0.9 km/day to 1 km/day.',
    choice: 'Use 328 km projected with At this year’s daily average. Keep a small, labelled reference bar for so far / projected / last year, with compact supporting values and meaningful rate precision.',
    detail: 'No expansion. The wording should describe a straight-line extrapolation, not a goal or a confident prediction. Support large text with labelled rows rather than squeezing a fixed grid.',
    decision: 'Recommended: keep the reference bar, with explicit labels. Its value is comparison, not progress toward a goal.',
  },
  {
    id: 'typicalWeek', title: 'Typical week', batch: 3,
    web: 'A concise average headline and three compact secondary values make this easy to scan. Some abbreviated supporting labels could be clearer.',
    ios: 'Full labels are easy to understand. Splitting the value and unit and stacking every supporting figure creates unnecessary height.',
    choice: 'Use 1.6 h / week, then 0.5 active days / week. Underneath, show Distance, Climb and Activities in a compact three-column summary, adapting to rows for larger text.',
    detail: 'Retain Average over 11 full weeks and consistent decimal precision. No expansion or decorative chart: this tile is a summary, and that is enough.',
    decision: 'Recommended: use the web’s hierarchy with the native version’s explicit labels.',
  },
  {
    id: 'records', title: 'Records', batch: 4,
    web: 'The collapsed 2×2 record grid is efficient; activity links and Best 30 days add useful detail. The expanded card is very long, with large bars and repeated sections competing for attention.',
    ios: 'Activity names and dates are readable. However, expansion shows All-time records beneath a still-visible This year heading. That changes the scope without a clear selection, and activity drill-down is missing.',
    choice: 'Keep a compact 2×2 this-year summary. Expanded: an explicit This year / All time choice, followed by readable linked record rows with names and dates. Scope must be unambiguous in every state.',
    detail: 'Include Best 30 days as a compact secondary section with dates and metric values. Avoid the web’s oversized progress bars and avoid truncating away the activity identity on phones.',
    decision: 'Recommended: expansion starts with this year’s details; All time is a deliberate choice, not a silent replacement.',
  },
  {
    id: 'activityCalendar', title: 'Activity calendar', batch: 4,
    web: 'Year-qualified month labels, a compact legend and historical navigation are useful. Small cells need careful inspection behavior. Mixed sports are striped.',
    ios: 'Cells and day descriptions are readable, but the legend is bulky and repeated month names lack year context. Mixed sports use a different mark. Expansion adds a long second day strip rather than selecting within the calendar.',
    choice: 'Use year-aware month labels, consistent cell spacing and a compact complete legend. Reconcile mixed sports to one striped treatment. Keep the existing colour metric choices and readable day descriptions.',
    detail: 'Expanded: rolling 12 months / calendar year, historical navigation, calendar selection and selected-day activity links. Replace the extra day strip with forgiving tap/drag inspection and an accessible date-selection alternative.',
    decision: 'Recommended: preserve the calendar’s compact density, but do not require precise taps on tiny cells. This is the largest interaction change in the remaining work.',
  },
];
const manifest = JSON.parse(readFileSync(new URL('../shared/stats-capabilities.v1.json', import.meta.url)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let reference;
let count = 0;
function shot(tile, platform, state) {
  const capability = manifest.tiles.find((t) => t.id === tile.id);
  if (state === 'expanded' && !capability.expandable) return '<div class="missing">No expansion needed</div>';
  const dir = platform === 'web' ? web : ios;
  const stem = `${platform}-${tile.id}-${state}`;
  const meta = JSON.parse(readFileSync(join(dir, stem + '.json')));
  reference ??= meta;
  for (const key of ['fixtureHash', 'today', 'activityCount', 'width', 'scale']) assert.equal(meta[key], reference[key], `${stem}: ${key}`);
  assert.equal(meta.option, capability.defaultOption ?? 'none', `${stem}: option`);
  assert.equal(meta.tile, tile.id); assert.equal(meta.platform, platform); assert.equal(meta.state, state);
  const png = readFileSync(join(dir, stem + '.png'));
  assert.equal(png.readUInt32BE(16), meta.width * meta.scale);
  assert(Math.abs(png.readUInt32BE(20) - meta.height * meta.scale) <= 2);
  count++;
  const label = `${platform === 'web' ? 'Web' : 'iOS'} · ${state}`;
  return `<figure><figcaption>${label}<small>${meta.width} × ${Math.round(meta.height)}</small></figcaption><img loading="lazy" width="${meta.width}" height="${meta.height}" alt="${esc(tile.title + ', ' + label)}" src="data:image/png;base64,${png.toString('base64')}"></figure>`;
}
const sections = reviews.map((r) => `<section id="${r.id}"><div class="eyebrow">Batch ${r.batch}</div><h2>${r.title}</h2><div class="assessment"><article><h3>Web</h3><p>${esc(r.web)}</p></article><article><h3>iOS</h3><p>${esc(r.ios)}</p></article><article class="recommendation"><h3>Proposed combination</h3><p>${esc(r.choice)}</p></article></div><p class="detail"><strong>Expanded / interaction:</strong> ${esc(r.detail)}</p><div class="shots">${shot(r, 'web', 'collapsed')}${shot(r, 'ios', 'collapsed')}${shot(r, 'web', 'expanded')}${shot(r, 'ios', 'expanded')}</div><p class="decision">${esc(r.decision)}</p></section>`).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stats reconciliation · remaining nine tiles</title>
<style>*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:78px}body{margin:0;background:#f4f5f7;color:#1b2638;font:15px/1.55 system-ui,sans-serif}header,main{max-width:1700px;margin:auto;padding:28px}header{padding-bottom:18px}h1{font-size:32px;letter-spacing:-1px;margin:8px 0}h2{font-size:27px;margin:0 0 16px}h3{font-size:15px;margin:0 0 6px}p{margin:0 0 14px}header p{max-width:1120px}.eyebrow{color:#52657d;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase}.meta{font-size:13px;color:#667085}.order{padding:16px 20px;border:1px solid #cbd7e5;border-radius:12px;background:#eaf0f7;max-width:1120px}.order ol{margin:6px 0;padding-left:22px}.order a{color:inherit}nav{position:sticky;top:0;z-index:2;display:flex;gap:8px;overflow-x:auto;padding:12px 28px;background:#1b2638}nav a{white-space:nowrap;color:white;background:#ffffff15;padding:5px 11px;border-radius:7px;text-decoration:none;font-size:13px}section{margin:0 0 56px;border-bottom:1px solid #d9dfe7;padding-bottom:20px}.assessment{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:16px;margin-bottom:16px}article{background:white;padding:16px 18px;border-radius:10px;border:1px solid #e1e5eb}article p{margin:0}.recommendation{background:#eaf1fa;border-color:#c9d8eb}.detail{max-width:1300px;color:#40526a}.shots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start;margin-top:20px}figure{margin:0;min-width:0}figcaption{font-weight:650;margin-bottom:10px}small{display:block;color:#68778a;font-weight:400}img{display:block;width:100%;height:auto;border-radius:8px;box-shadow:0 1px 5px #1621381a;cursor:zoom-in}.missing{padding:30px;background:#e9edf2;color:#67768a;text-align:center;border-radius:8px}.decision{margin:18px 0 0;padding-left:14px;border-left:3px solid #5478a8;color:#324a69}dialog{border:0;border-radius:12px;padding:16px;max-height:96vh;max-width:96vw;overflow:auto}dialog::backdrop{background:#000a}dialog img{width:378px;max-width:85vw}dialog button{display:block;margin:0 0 12px auto;padding:8px 18px}footer{padding:0 28px 30px;font-size:12px;color:#68778a}@media(max-width:1050px){.shots{grid-template-columns:repeat(4,300px);overflow-x:auto;padding-bottom:14px}.assessment{grid-template-columns:1fr 1fr}.recommendation{grid-column:1/-1}}@media(max-width:600px){header,main{padding:20px}.assessment{grid-template-columns:1fr}.recommendation{grid-column:auto}h1{font-size:27px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}</style>
<header><div class="eyebrow">Review proposals · 4 October 2026</div><h1>The next nine tiles</h1><p>Keep the web’s concise summaries, iOS’s readable chart space, and the useful detail from either platform. These are recommendations for discussion, not implemented redesigns. This week and Training volume are already reconciled and are omitted here.</p><div class="order"><strong>Recommended sequence</strong><ol><li><a href="#monthVsLastMonth">This month + Year to date</a> — settle the shared cumulative comparison chart.</li><li><a href="#consistency">Consistency + Hilliness</a> — reconcile weekly/monthly bars and scales.</li><li><a href="#sportMix">Sport mix + Year-end projection + Typical week</a> — improve compact summaries.</li><li><a href="#records">Records + Activity calendar</a> — complete the richer selection and activity drill-down flows.</li></ol></div><p class="meta" style="margin-top:16px">${count} real tile captures · same ${reference.activityCount}-activity fixture · reporting date ${reference.today} · 378pt/CSS-pixel card width · 2× resolution · light appearance. iOS was recaptured after the shared-picker and partial-fill fixes. Web captures are reused from the earlier pilot for these unchanged tiles. Natural heights are preserved. Click a screenshot to inspect at its logical width; narrow windows scroll each four-image comparison sideways.</p><p class="meta">This sparse fixture exposes labels, density and missing features. Dense histories, dark mode, large text, full-screen layout and touch behavior need a separate acceptance pass after each agreed implementation batch.</p></header>
<nav aria-label="Tiles">${reviews.map((r) => `<a href="#${r.id}">${r.title}</a>`).join('')}</nav><main>${sections}</main><dialog><button type="button">Close</button><img alt=""></dialog><script>const d=document.querySelector('dialog');document.querySelectorAll('figure img').forEach(i=>i.onclick=()=>{const z=d.querySelector('img');z.src=i.src;z.alt=i.alt;d.showModal()});d.querySelector('button').onclick=()=>d.close();d.onclick=e=>{if(e.target===d)d.close()};</script><footer>Fixture SHA-256: ${reference.fixtureHash}. Web: production dashboard element captures. iOS: isolated production SwiftUI tiles. Review covers content and styling; isolated captures do not certify device interaction.</footer></html>`;
writeFileSync(join(ios, 'next.html'), html);
console.log(`Verified ${count} matched captures; wrote ${join(ios, 'next.html')}`);
