import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { RichContext } from './rich-context';

const directory = path.resolve(
  process.argv[2] ?? 'output/activity-name-prototype',
);
type Result = {
  sample: string;
  runName?: string;
  maxTokens?: number;
  title: string | null;
  rawNames: string[];
  explanation: string;
  validationErrors: string[];
  candidateCount: number;
  encounterCount: number;
  inputCharacters: number;
  elapsedMs: number;
  usage: { cost?: number; prompt_tokens: number; completion_tokens: number };
  contextHash: string;
  format: string;
  selectedEvidence: {
    feature: RichContext['features'][number];
    encounter: RichContext['encounters'][number];
  }[];
};
const base = JSON.parse(
  await readFile(path.join(directory, 'results.json'), 'utf8'),
) as {
  results: {
    activity: { name: string; category: string };
    title: string | null;
  }[];
};
const previous = JSON.parse(
  await readFile(
    path.join(directory, 'runs/flash-v3/model-results.json'),
    'utf8',
  ),
) as { suggestions: { sample: string; title: string | null }[] };
async function readRun(name: string) {
  const root = path.join(directory, 'rich', name);
  let files: string[];
  try {
    files = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(
    files
      .filter((f) => f.endsWith('-result.json'))
      .map(
        async (f) =>
          JSON.parse(await readFile(path.join(root, f), 'utf8')) as Result,
      ),
  );
}
const merge = (runs: Result[][]) => [
  ...new Map(runs.flat().map((r) => [r.sample, r])).values(),
];
const tsv = merge([
    await readRun('flash-rich-tsv'),
    await readRun('flash-rich-tsv-16k'),
  ]),
  json = merge([
    await readRun('flash-rich-json'),
    await readRun('flash-rich-json-16k'),
  ]);
let notes: Record<string, { assessment: string; note: string }> = {};
try {
  notes = JSON.parse(
    await readFile(path.join(directory, 'rich/review-notes.json'), 'utf8'),
  ) as typeof notes;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const esc = (value: string | number | null | undefined) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const show = (title: string | null | undefined) =>
  esc(title ?? 'No suggestion');
let totalCost = 0;
let attempts = 0,
  truncated = 0;
for (const run of [
  'flash-rich-tsv',
  'flash-rich-json',
  'flash-rich-tsv-16k',
  'flash-rich-json-16k',
]) {
  const root = path.join(directory, 'rich', run);
  let files: string[];
  try {
    files = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    throw error;
  }
  for (const f of files.filter((f) => f.endsWith('-response.json'))) {
    const response = JSON.parse(await readFile(path.join(root, f), 'utf8')) as {
      usage: { cost?: number };
      choices: { finish_reason: string }[];
    };
    totalCost += response.usage.cost ?? 0;
    attempts++;
    if (response.choices[0]?.finish_reason === 'length') truncated++;
  }
}
const pairs = json
  .map((j) => ({ j, t: tsv.find((t) => t.sample === j.sample)! }))
  .filter((p) => p.t);
const pairsTsv = pairs.reduce((sum, p) => sum + p.t.usage.prompt_tokens, 0),
  pairsJson = pairs.reduce((sum, p) => sum + p.j.usage.prompt_tokens, 0);
const table = `<table><thead><tr><th>Outing</th><th>TSV input tokens</th><th>JSON input tokens</th><th>Reduction</th><th>JSON suggestion</th></tr></thead><tbody>${pairs.map(({ j, t }) => `<tr><td>${esc(base.results[Number(j.sample.slice(7)) - 1]!.activity.name)}</td><td>${t.usage.prompt_tokens.toLocaleString()}</td><td>${j.usage.prompt_tokens.toLocaleString()}</td><td>${(100 * (1 - t.usage.prompt_tokens / j.usage.prompt_tokens)).toFixed(1)}%</td><td>${show(j.title)}${j.validationErrors.length ? `<br>${esc(j.validationErrors.join('; '))}` : ''}</td></tr>`).join('')}</tbody></table>`;
const cards = base.results
  .map((b, i) => {
    const sample = `sample_${i + 1}`,
      r = tsv.find((r) => r.sample === sample),
      j = json.find((r) => r.sample === sample),
      n = notes[sample];
    return `<article data-category="${esc(b.activity.category)}"><small>${esc(b.activity.category.toUpperCase())} · ${sample}</small><div class="names"><div><label>Existing title · withheld</label><h2>${esc(b.activity.name)}</h2></div><div><label>Previous shortlist model</label><h2>${show(previous.suggestions.find((s) => s.sample === sample)?.title)}</h2></div><div><label>Rich evidence · TSV</label><h2>${r ? show(r.title) : 'Request failed / pending'}</h2></div></div>${n ? `<aside><strong>${esc(n.assessment)}</strong><p>${esc(n.note)}</p></aside>` : ''}${r ? `<p>${esc(r.explanation)}</p>${r.validationErrors.length ? `<p class="warning">Rejected: ${esc(r.validationErrors.join('; '))}. Raw selection: ${esc(r.rawNames.join(' – '))}</p>` : ''}<div class="scroll"><table><thead><tr><th>Selected feature</th><th>OSM elevation</th><th>Route elevation</th><th>From track</th><th>Route %</th><th>From start / end</th><th>Rise before / drop after (2 km)</th></tr></thead><tbody>${r.selectedEvidence.map(({ feature: f, encounter: e }) => (f && e ? `<tr><td>${esc(f.name)}</td><td>${esc(f.osmElevationM ?? '—')} m</td><td>${esc(e.routeElevationM ?? '—')} m</td><td>${esc(e.distanceM)} m</td><td>${esc(e.routePercent)}%</td><td>${esc(f.startDistanceM)} / ${esc(f.endDistanceM)} m</td><td>${esc(e.riseBefore2kmM ?? '—')} / ${esc(e.dropAfter2kmM ?? '—')} m</td></tr>` : '')).join('')}</tbody></table></div><p class="meta">${r.candidateCount.toLocaleString()} candidates · ${r.encounterCount.toLocaleString()} approaches · ${r.usage.prompt_tokens.toLocaleString()} input tokens · ${(r.elapsedMs / 1000).toFixed(1)} s · $${r.usage.cost?.toFixed(5) ?? '?'}</p>` : ''}<details><summary>Inspect exact inputs${j ? ' and JSON control' : ''}</summary><p><a href="rich/contexts/${sample}.tsv">Compact table</a> · <a href="rich/contexts/${sample}.json">Same evidence as JSON</a> · <a href="rich/${r?.runName ?? 'flash-rich-tsv'}/${sample}-request.json">Full saved request + prompt</a> · <a href="rich/${r?.runName ?? 'flash-rich-tsv'}/${sample}-result.json">Result and evidence</a></p>${j ? `<p><strong>JSON control:</strong> ${show(j.title)}</p><p>${esc(j.explanation)}</p><p>${j.usage.prompt_tokens.toLocaleString()} input tokens · ${(j.elapsedMs / 1000).toFixed(1)} s · $${j.usage.cost?.toFixed(5) ?? '?'}</p>` : ''}</details></article>`;
  })
  .join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity naming · richer evidence</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f5f2;color:#18332e;font:16px/1.55 system-ui,sans-serif}main{max-width:1150px;margin:auto;padding:40px 24px}h1{font-size:36px;letter-spacing:-1px}h2{font-size:21px;line-height:1.35}header p{max-width:950px}.panel,article{background:white;padding:24px;border:1px solid #dce5df;border-radius:16px;margin:24px 0}.names{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}label,small,.meta{font-size:13px;color:#61736c}aside{background:#faf6ed;border-left:3px solid #d4aa62;padding:14px 18px}aside p{margin:4px 0}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;text-align:left;border-bottom:1px solid #e2e9e3}th{font-weight:600}a{color:#286b54}details{border-top:1px solid #e3ebe5;padding-top:14px}summary{cursor:pointer}.warning{color:#95551b}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #b9cec4;border-radius:22px;background:white;color:inherit;padding:10px 18px;cursor:pointer}button.active{background:#183f35;color:white}footer{font-size:13px;color:#61736c}@media(max-width:700px){main{padding:24px 14px}.names{grid-template-columns:1fr;gap:0}h1{font-size:29px}.panel,article{padding:18px}}</style></head><body><main><header><p>ACTIVITYMAP / RICH-EVIDENCE EXPERIMENT</p><h1>Let the model weigh the geography.</h1><p>All 10,238 nearby OSM candidates retained across 17 outings. No altitude-based eligibility filter, summit-ranking rule, deduplication by proximity, or primary/secondary destination labels. The model sees distances, route elevations, progress percentages and local height changes. These are derived route summaries; raw coordinates, tracks, dates, activity IDs and existing titles are not sent.</p><p>Model: <strong>google/gemini-3-flash</strong>. ${tsv.length}/17 TSV requests completed and ${json.length}/3 JSON controls completed. Each request describes one outing. Total recorded cost: <strong>$${totalCost.toFixed(4)}</strong> across ${attempts} responses, including ${truncated} truncated initial attempts. Requests initially allowed 4,000 output/reasoning tokens; retries allowed 16,000. Latest completed results are shown, without selecting by title quality. One completed result per displayed configuration; the development sample is not a held-out accuracy benchmark.</p><p>The previous comparison used preselected features and batched 17 outings. This test changes both the evidence and the request grouping, so differences cannot be attributed solely to either. The TSV/JSON controls use identical evidence, system prompt and response schema for each paired outing. The displayed paired controls use the 16,000-token allowance; earlier attempts remain saved.</p></header><section class="panel"><h2>Compact tables versus JSON</h2><p>Three TSV tables share their column headings: route summary, OSM features, and separate approaches to those features. This removes repeated JSON field names. Empty cells mean unknown, and quoted cells can contain tabs/newlines. Model output remains structured JSON because it is small and easy to validate.</p><p>On the ${pairs.length} matched controls, TSV uses <strong>${pairsJson ? (100 * (1 - pairsTsv / pairsJson)).toFixed(1) : '—'}% fewer input tokens</strong> (${pairsTsv.toLocaleString()} versus ${pairsJson.toLocaleString()}, including the common system prompt and any provider accounting overhead). Savings are measured from Gateway usage, not estimated from file size.</p><div class="scroll">${table}</div></section><nav aria-label="Filter outings"><button class="active" data-filter="all">All outings</button><button data-filter="bike">Bike rides</button><button data-filter="hike">Hikes</button><button data-filter="ski">Ski tours</button></nav>${cards}<footer>Geographic features © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>. Suggestions are experimental; no activities changed. <a href="report.html">Previous comparison</a>.</footer></main><script>document.querySelectorAll('button[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('button[data-filter]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('article').forEach(a=>a.hidden=b.dataset.filter!=='all'&&a.dataset.category!==b.dataset.filter)}))</script></body></html>`;
await writeFile(path.join(directory, 'rich-report.html'), html);
console.log(
  JSON.stringify({
    completed: tsv.length,
    jsonControls: json.length,
    totalCost,
    inputTokenReduction: pairsJson ? 1 - pairsTsv / pairsJson : null,
  }),
);
