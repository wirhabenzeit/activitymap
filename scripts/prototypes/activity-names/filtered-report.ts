import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type ChoiceAnswer, type FilteredContext } from './filtered-context';

const root = path.resolve('output/activity-name-prototype');
type Result = {
  runName?: string;
  reasoningEffort?: string;
  sample: string;
  title: string | null;
  format: string;
  warning: string | null;
  answers: Record<string, ChoiceAnswer>;
  inputHash: string;
  elapsedMs: number;
  cost: number | null;
  inputTokens: number;
  candidateCount: number;
  originalCount: number;
};
const read = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(path.join(root, file), 'utf8')) as T;
const base = await read<{
  results: { activity: { name: string; category: string } }[];
}>('results.json');
const jev = await read<{ results: Result[] }>('filtered/jev-v2/summary.json');
const gemini = await read<{ results: Result[] }>(
  'filtered/gemini-v2/summary.json',
);
let retries: Result[] = [];
try {
  retries = (
    await read<{ results: Result[] }>(
      'filtered/gemini-low-retry-v2/summary.json',
    )
  ).results.filter((r) => r.answers);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
gemini.results = [
  ...new Map(
    [...gemini.results, ...retries].map((r) => [r.sample, r]),
  ).values(),
];
let allAttemptsCost = 0,
  attempts = 0,
  truncated = 0;
for (const run of ['jev-v2', 'gemini-v2', 'gemini-low-retry-v2']) {
  let files: string[];
  try {
    files = await readdir(path.join(root, 'filtered', run));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
    throw e;
  }
  for (const file of files.filter((f) => f.endsWith('-response.json'))) {
    const { raw } = await read<{
      raw: {
        usage: { cost?: number };
        providerMetadata?: { gateway?: { cost?: string } };
        choices?: { finish_reason: string }[];
      };
    }>(`filtered/${run}/${file}`);
    allAttemptsCost +=
      raw.usage.cost ?? Number(raw.providerMetadata?.gateway?.cost ?? 0);
    attempts++;
    if (raw.choices?.[0]?.finish_reason === 'length') truncated++;
  }
}
const old = await read<{
  suggestions: { sample: string; title: string | null }[];
}>('runs/flash-v3/model-results.json');
let notes: Record<string, string> = {};
try {
  notes = await read<Record<string, string>>('filtered/review-notes.json');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const name = (s: string | null | undefined) => esc(s ?? 'No suggestion');
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const valid = (rows: Result[]) => rows.filter((r) => r.answers);
const j = valid(jev.results),
  g = valid(gemini.results);
const stats = (rows: Result[]) => ({
  completed: rows.length,
  medianMs: median(rows.map((r) => r.elapsedMs)),
  cost: rows.reduce((sum, r) => sum + (r.cost ?? 0), 0),
  inputTokens: rows.reduce((sum, r) => sum + r.inputTokens, 0),
});
const js = stats(j),
  gs = stats(g);
const totalBefore = g.reduce((sum, r) => sum + r.originalCount, 0),
  totalAfter = g.reduce((sum, r) => sum + r.candidateCount, 0);
const pairsMatch =
  j.length === 17 &&
  g.length === 17 &&
  j.every(
    (r) => g.find((x) => x.sample === r.sample)?.inputHash === r.inputHash,
  );
const answer = (r: Result | undefined, key: string) => {
  const a = r?.answers?.[key];
  if (!a) return '—';
  return `${esc(a.choice)}${a.probabilities ? ` <small>(${Math.round(100 * (a.probabilities[a.choice] ?? 0))}%)</small>` : ''}`;
};
const cards: string[] = [];
for (const [i, b] of base.results.entries()) {
  const sample = `sample_${i + 1}`,
    a = j.find((r) => r.sample === sample),
    z = g.find((r) => r.sample === sample);
  const c = await read<FilteredContext>(`filtered/contexts/${sample}.json`);
  const audit = await read<{
    originalCount: number;
    deduplicatedCount: number;
    eligibleCount: number;
    selectedCount: number;
  }>(`filtered/contexts/${sample}-audit.json`);
  const rows = c.features
    .map((f) => {
      const e = c.encounters
        .filter((x) => x.feature === f.key)
        .sort(
          (x, y) => (x.distanceM ?? Infinity) - (y.distanceM ?? Infinity),
        )[0];
      return `<tr><td>${esc(f.name)}<br><small>${esc(f.key)} · ${esc(f.type)}${f.place ? ` · ${esc(f.place)}` : ''}</small></td><td>${esc(e?.distanceM ?? '—')} m</td><td>${esc(f.osmElevationM ?? '—')} / ${esc(e?.routeElevationM ?? '—')} m</td><td>${esc(e?.routePercent ?? '—')}%</td><td>${esc(f.startDistanceM)} / ${esc(f.endDistanceM)} m</td><td>${answer(a, `${f.key}_visit`)}<br>${answer(a, `${f.key}_role`)}</td><td>${answer(z, `${f.key}_visit`)}<br>${answer(z, `${f.key}_role`)}</td></tr>`;
    })
    .join('');
  cards.push(
    `<article data-category="${esc(b.activity.category)}"><small>${esc(b.activity.category.toUpperCase())} · ${sample}</small><h2>${esc(b.activity.name)}</h2><p class="meta">Existing title, withheld from both models. ${audit.originalCount.toLocaleString()} original → ${audit.deduplicatedCount.toLocaleString()} deduplicated → ${audit.eligibleCount} eligible → ${audit.selectedCount} sent.</p><div class="names"><section><label>Previous shortlist · Gemini</label><h3>${name(old.suggestions.find((r) => r.sample === sample)?.title)}</h3></section><section><label>Filtered evidence · Jev</label><h3>${name(a?.title)}</h3><p class="meta">${a ? `${(a.elapsedMs / 1000).toFixed(2)} s · $${a.cost?.toFixed(6) ?? '?'} · ${a.inputTokens.toLocaleString()} input tokens` : 'Missing response'}</p>${a?.warning ? `<p>${esc(a.warning)}</p>` : ''}</section><section><label>Filtered evidence · Gemini</label><h3>${name(z?.title)}</h3><p class="meta">${z ? `${(z.elapsedMs / 1000).toFixed(2)} s · $${z.cost?.toFixed(6) ?? '?'} · ${z.inputTokens.toLocaleString()} input tokens` : 'Missing response'}</p>${z?.reasoningEffort === 'low' ? '<p class="meta">Retried with low reasoning after a truncated default response.</p>' : ''}${z?.warning ? `<p>${esc(z.warning)}</p>` : ''}</section></div>${notes[sample] ? `<aside>${esc(notes[sample])}</aside>` : ''}<details><summary>See every candidate and both models’ decisions</summary><p>Each cell shows visitation, then title significance. Jev percentages are its probability for the chosen class, not a measured accuracy rate. Gemini was asked for choices only. Evidence below uses the closest encounter; the full input retains all encounters.</p><div class="scroll"><table><thead><tr><th>Place</th><th>From route</th><th>OSM / route elevation</th><th>Progress</th><th>From start / end</th><th>Jev</th><th>Gemini</th></tr></thead><tbody>${rows}</tbody></table></div><p>Endpoint choices: Jev ${answer(a, 'start')} → ${answer(a, 'end')}; Gemini ${answer(z, 'start')} → ${answer(z, 'end')}.</p></details><details><summary>Exact data, prompts and filter audit</summary><p><a href="filtered/contexts/${sample}.json">Shared evidence JSON</a> · <a href="filtered/contexts/${sample}.tsv">Feature/encounter tables</a> · <a href="filtered/contexts/${sample}-audit.json">Retained / removed / merged features</a></p><p><a href="filtered/jev-v2/${sample}-request.json">Jev full request</a> · <a href="filtered/jev-v2/${sample}-response.json">Jev raw response</a> · <a href="filtered/${z?.runName ?? 'gemini-v2'}/${sample}-request.json">Gemini full request</a> · <a href="filtered/${z?.runName ?? 'gemini-v2'}/${sample}-response.json">Gemini raw response</a></p></details></article>`,
  );
}
const metrics = {
  allAttemptsCost,
  attempts,
  truncated,
  lowReasoningRetries: retries.length,
  jev: js,
  gemini: gs,
  totalBefore,
  totalAfter,
  candidateReductionPercent: 100 * (1 - totalAfter / totalBefore),
  exactInputsMatch: pairsMatch,
};
await writeFile(
  path.join(root, 'filtered/metrics.json'),
  JSON.stringify(metrics, null, 2),
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity naming · Jev vs Gemini</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f5f1;color:#18382f;font:16px/1.5 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:36px 24px}h1{font-size:38px;letter-spacing:-1.1px;line-height:1.15}h2{font-size:24px;margin-bottom:6px}h3{font-size:21px;line-height:1.35;margin:10px 0}header p{max-width:900px}article,.panel{background:white;border:1px solid #dbe5df;border-radius:16px;padding:24px;margin:24px 0}.names{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}label,.meta,small{font-size:13px;color:#65766d}aside{background:#faf5e9;border-left:3px solid #caa465;padding:14px 18px;margin:16px 0}details{border-top:1px solid #e3e9e5;padding:14px 0 0;margin-top:14px}summary{cursor:pointer;font-weight:600}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e3e9e5}a{color:#246b50}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;padding:9px 18px;border:1px solid #b9cec1;border-radius:24px;background:white;color:inherit;cursor:pointer}button.active{background:#194736;color:white}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.stats strong{display:block;font-size:29px}.stats small{display:block}footer{font-size:13px;color:#65766d;margin:30px 0}@media(max-width:760px){main{padding:20px 14px}h1{font-size:30px}.names{grid-template-columns:1fr;gap:8px}.stats{grid-template-columns:1fr}article,.panel{padding:18px}}</style></head><body><main><header><p>ACTIVITYMAP / FILTERED GEOGRAPHIC EVIDENCE</p><h1>Same shortlist. Two different decision models.</h1><p>17 outings, the same compact geographic tables and the same classification questions. Both models judge whether a place was visited and whether it belongs in the title. Names and endpoint fallbacks are assembled with identical local rules.</p></header><section class="panel"><div class="stats"><div><strong>${metrics.candidateReductionPercent.toFixed(1)}% fewer</strong><small>${totalBefore.toLocaleString()} → ${totalAfter} candidates across all outings</small></div><div><strong>${(js.medianMs / 1000).toFixed(2)} s / ${(gs.medianMs / 1000).toFixed(2)} s</strong><small>Median latency · Jev / Gemini</small></div><div><strong>$${allAttemptsCost.toFixed(4)}</strong><small>Total cost including failed attempts</small></div></div><p>Jev: ${js.completed}/17 completed, $${js.cost.toFixed(4)} for successful responses. Gemini: ${gs.completed}/17 completed, $${gs.cost.toFixed(4)} for successful responses. ${attempts} responses in total, including ${truncated} truncated attempts; ${retries.length} cases retried with lower reasoning. Exact shared input and question hashes match: <strong>${pairsMatch ? '17/17' : 'CHECK FAILED'}</strong>.</p><p>This is an exploratory comparison on the same development sample, not a held-out accuracy benchmark. Current titles are shown only for review. Alternative names can be equally good. Latencies are one observation per outing and include network overhead; token counts use different model tokenizers.</p></section><details class="panel"><summary>What the pre-filter does</summary><p>Nearby OSM representations with the same name and kind are merged within 250 m, unless their known elevations differ by more than 50 m. No distinct named mountains are merged. Retain passes within 400 m of the route, peaks within 180 m or within 1.2 km horizontally and 1 km of travel from a route high point, endpoint places within 2.5 km, and places/huts near high points (350 m from track and 750 m of travel). No elevation-consistency or minimum-climb rejection is applied to these candidates.</p><p>High points use approximately 100 m distance sampling, smoothing within 200 m, local maxima with at least 30 m rise and drop within 750 m, plus the highest point and a high uphill finish. These are candidate-generation settings, not proof of a summit visit. The 40-feature budget reserves slots for endpoints, passes, peaks and other destinations. Wikipedia/Wikidata is a small ranking bonus, never a requirement.</p><p>Both models see distances, route elevations, progress, windowed height changes and high points. No raw coordinates, tracks, dates, IDs or existing activity titles are sent. Map names use available English/international OSM names, otherwise the original name. Output uses features classified both supported and main. Exact duplicate display names appear once. More than four distinct names requires review; cycling can fall back to endpoint names. Independent choices can still be geographically wrong or inconsistent.</p></details><nav aria-label="Filter outings"><button class="active" data-filter="all">All 17</button><button data-filter="bike">Bike rides</button><button data-filter="hike">Hikes</button><button data-filter="ski">Ski tours</button></nav>${cards.join('')}<footer>Map data © OpenStreetMap contributors. Model IDs: typesafe-ai/jev · google/gemini-3-flash. All responses and request hashes saved locally. No activities changed. <a href="rich-report.html">Previous broad-evidence experiment</a> · <a href="report.html">Original experiment</a></footer></main><script>document.querySelectorAll('button[data-filter]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('button[data-filter]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('article').forEach(a=>a.hidden=button.dataset.filter!=='all'&&a.dataset.category!==button.dataset.filter)}));</script></body></html>`;
await writeFile(path.join(root, 'filtered-report.html'), html);
console.log(JSON.stringify(metrics));
