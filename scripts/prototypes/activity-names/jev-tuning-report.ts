import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FilteredContext } from './filtered-context';

const root = path.resolve('output/activity-name-prototype');
type Result = {
  sample: string;
  title: string | null;
  warning: string | null;
  candidateCount: number;
  elapsedMs: number;
  inputTokens: number;
  cost: number;
  requestHash: string;
  answers: Record<string, { choice: string }>;
};
const read = async <T>(p: string): Promise<T> =>
  JSON.parse(await readFile(path.join(root, p), 'utf8')) as T;
const specs = [
  ['jev-v2', 'Previous Jev'],
  ['jev-slim-control-v3', 'Smaller list · original prompt'],
  ['jev-tuned40-v3', 'Original list · rewritten prompt'],
  ['jev-tuned-slim-v3', 'Smaller list · rewritten prompt'],
  ['jev-minimal-slim-v4', 'Smaller list · targeted wording'],
  ['jev-minimal-reversed-v4', 'Targeted wording · reversed options'],
] as const;
const runs = new Map<string, Result[]>();
for (const [run] of specs)
  runs.set(
    run,
    (await read<{ results: Result[] }>(`filtered/${run}/summary.json`)).results,
  );
const base = await read<{
  results: {
    activity: { name: string; category: string };
    selected: { name: string }[];
  }[];
}>('results.json');
const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const title = (r: Result) =>
  esc(
    r.title ??
      (r.warning ? 'Needs review: too many destinations' : 'No suggestion'),
  );
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const result = (run: string, sample: string) =>
  runs.get(run)!.find((r) => r.sample === sample)!;
const proposal: Result[] = [];
const cards: string[] = [];
let keptOriginal = true;
const notes = [
  'Fiescheralp is preserved; the unrelated extra Nesselweg disappears.',
  'The cycling wording recovers Brünigpass and Glaubenbergpass alongside Furka and Grimsel. Winterlücke and Rengg remain secondary.',
  'The English-name endpoint pair Naryn – Örük-Tam replaces the questionable Tamdy-Suu destination.',
  'Still abstains because no supplied place reasonably identifies the finish.',
  'The cycling wording restores Ibergeregg. The extra southern Pragel saddle is omitted.',
  'Foggenhorn is retained as the only nearby mountain candidate.',
  'Federispitz remains concise with the original mountain wording; both rewritten prompts added Plättlispitz.',
  'Cable-car station and area labels are gone. Rosegg – Esel – Oberhaupt still includes extra mountain names; this is a significance question, not simply duplicate text.',
  'The proposal now includes Gufelstock, with Schwarzstöckli and Höch. These peaks are closely matched, but deciding which are equally significant remains subjective. The targeted rewrite over-selected more than four and was rejected.',
  'The smaller list with original wording recovers Altmann – Säntis. The targeted rewrite lost Altmann, so changing the wording everywhere would be a regression.',
  'Federispitz – Mattstock replaces the longer list with minor intermediate names.',
  'Bärenhorn remains; the questionable Chüefadstock candidate was removed by the tighter distance filter.',
  'Remaining uncertainty: the tiny list contains only Rotstogg, and Jev now proposes it instead of abstaining. This does not recover the intended Chli Kärpf destination. A smaller list can also create false confidence.',
  'Pucher disappears, but Ruchennadel remains alongside Gross Ruchen. Its visitation/significance still deserves review.',
  'Both Piz Badus and Rossbodenstock remain.',
  'The original wording on the smaller list restores Misthufen alone. The rewritten variants add Wiss Nollen.',
  'Läged Windgällen remains; Ruosalp Chulm is treated as a secondary approach pass.',
];
for (const [i, item] of base.results.entries()) {
  const sample = `sample_${i + 1}`;
  const source =
    item.activity.category === 'bike'
      ? 'jev-minimal-slim-v4'
      : 'jev-slim-control-v3';
  const selected = result(source, sample),
    previous = result('jev-v2', sample);
  const c = await read<FilteredContext>(`filtered/${source}/${sample}.json`);
  const prepared = await read<{ requestHash: string }>(
    `filtered/jev-sport-slim-v5/${sample}-request.json`,
  );
  assert.equal(
    prepared.requestHash,
    selected.requestHash,
    'Proposed policy must reproduce the exact tested request, not choose per-activity outputs',
  );
  proposal.push(selected);
  const names = new Set(c.features.flatMap((f) => [f.name, f.localName]));
  if (item.selected.some((f) => !names.has(f.name))) keptOriginal = false;
  const variantRows = specs
    .map(([run, label]) => {
      const r = result(run, sample);
      return `<tr><td>${label}</td><td>${title(r)}</td><td>${r.candidateCount}</td><td>${r.elapsedMs} ms</td><td><a href="filtered/${run}/${sample}-request.json">Request</a> · <a href="filtered/${run}/${sample}-response.json">Response</a></td></tr>`;
    })
    .join('');
  cards.push(
    `<article data-category="${esc(item.activity.category)}"><small>${esc(item.activity.category.toUpperCase())} · ${sample}</small><h2>${esc(item.activity.name)}</h2><p class="meta">Existing title withheld · ${previous.candidateCount} → ${selected.candidateCount} candidates</p><div class="comparison"><section><label>Previous Jev</label><h3>${title(previous)}</h3></section><section><label>Proposed sport-specific policy</label><h3>${title(selected)}</h3><p class="meta">${selected.elapsedMs} ms · $${selected.cost.toFixed(6)}</p></section></div><aside>${esc(notes[i])}</aside><details><summary>The ${selected.candidateCount} candidates and exact prompt</summary><p>${c.features.map((f) => esc(f.name)).join(' · ')}</p><p><a href="filtered/${source}/${sample}.json">Evidence</a> · <a href="filtered/${source}/${sample}-audit.json">Removed candidates</a> · <a href="filtered/${source}/${sample}-request.json">Full prompt and questions</a> · <a href="filtered/${source}/${sample}-response.json">Raw response</a></p><p>Reused tested run: ${source}. The proposed policy’s request hash matches this response exactly.</p></details><details><summary>Every trial, including regressions</summary><div class="scroll"><table><thead><tr><th>Variant</th><th>Suggestion</th><th>Places</th><th>Time</th><th>Inspect</th></tr></thead><tbody>${variantRows}</tbody></table></div></details></article>`,
  );
}
const old = runs.get('jev-v2')!;
const totalBefore = old.reduce((s, r) => s + r.candidateCount, 0),
  totalAfter = proposal.reduce((s, r) => s + r.candidateCount, 0);
const currentRuns = specs.slice(1).flatMap(([run]) => runs.get(run)!);
const targeted = runs.get('jev-minimal-slim-v4')!,
  reversed = runs.get('jev-minimal-reversed-v4')!;
const stableTitles = targeted.filter(
  (r) => result('jev-minimal-reversed-v4', r.sample).title === r.title,
).length;
const changedAnswers = targeted.reduce(
  (sum, r) =>
    sum +
    Object.entries(r.answers).filter(
      ([key, a]) =>
        result('jev-minimal-reversed-v4', r.sample).answers[key]?.choice !==
        a.choice,
    ).length,
  0,
);
assert.equal(reversed.length, 17);
const metrics = {
  totalBefore,
  totalAfter,
  reductionPercent: 100 * (1 - totalAfter / totalBefore),
  medianCandidates: median(proposal.map((r) => r.candidateCount)),
  medianMs: median(proposal.map((r) => r.elapsedMs)),
  oldMedianMs: median(old.map((r) => r.elapsedMs)),
  inputTokens: proposal.reduce((s, r) => s + r.inputTokens, 0),
  oldInputTokens: old.reduce((s, r) => s + r.inputTokens, 0),
  proposalCost: proposal.reduce((s, r) => s + r.cost, 0),
  experimentCost: currentRuns.reduce((s, r) => s + r.cost, 0),
  calls: currentRuns.length,
  stableTitles,
  changedAnswers,
  allOriginalMatcherDestinationsRetained: keptOriginal,
};
await mkdir(path.join(root, 'jev-tuning'), { recursive: true });
await writeFile(
  path.join(root, 'jev-tuning/metrics.json'),
  JSON.stringify(metrics, null, 2),
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity naming · tuning Jev</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f5f1;color:#193c31;font:16px/1.55 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:34px 24px}h1{font-size:36px;line-height:1.2;letter-spacing:-1px}h2{font-size:23px;margin:8px 0}h3{font-size:22px;line-height:1.3}.panel,article{background:white;border:1px solid #dce7df;border-radius:16px;padding:24px;margin:24px 0}.stats,.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.stats strong{font-size:30px;display:block}small,label,.meta{color:#63766b;font-size:13px}aside{background:#faf5e9;padding:14px;border-left:3px solid #d1ab68}details{margin-top:16px;border-top:1px solid #e0e8e2;padding-top:12px}summary{cursor:pointer;font-weight:600}a{color:#286d52}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e1e9e3}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #b7cdbc;background:white;color:inherit;border-radius:24px;padding:9px 18px;cursor:pointer}button.active{background:#194b36;color:white}footer{font-size:13px;color:#63766b}@media(max-width:700px){main{padding:20px 14px}.stats,.comparison{grid-template-columns:1fr;gap:8px}h1{font-size:29px}.panel,article{padding:18px}}</style></head><body><main><header><p>ACTIVITYMAP / JEV TUNING</p><h1>Fewer places. Keep the fast response.</h1><p>The smaller shortlist helps more consistently than rewriting every question. The proposed policy uses the targeted cycling wording for bike rides and the original mountain wording for hikes and ski tours, always with the smaller list.</p></header><section class="panel"><div class="stats"><div><strong>${totalBefore} → ${totalAfter}</strong><small>${metrics.reductionPercent.toFixed(1)}% fewer candidates than the previous Jev test</small></div><div><strong>${metrics.medianCandidates} places</strong><small>Median shortlist · range 1–11</small></div><div><strong>${metrics.medianMs} ms</strong><small>Median observed response time · previous ${metrics.oldMedianMs} ms</small></div><div><strong>$${metrics.experimentCost.toFixed(4)}</strong><small>All ${metrics.calls} new requests across five variants</small></div></div><p>The proposed 17-response combination costs $${metrics.proposalCost.toFixed(4)}. It reuses already tested responses: one rule per sport, not a per-activity choice of the best answer. Every proposed request hash matches the corresponding saved response.</p><p>Candidate counts and response speed are measured. Name quality is reviewed qualitatively on the same 17 development outings. The sport-specific policy was chosen after seeing these trials; it still needs unseen activities. ${keptOriginal ? 'Every destination selected by the original geometry matcher survives the smaller filter.' : 'Some original matcher destinations are absent; inspect candidate lists.'}</p></section><details class="panel"><summary>What changed, and what did not work</summary><p>Hikes/ski tours keep up to eight peaks within 350 m of the route, two nearby passes and one nearby hut. Ordinary settlements and cable-car stations are omitted. Cycling keeps up to eight passes within 200 m, two meaningful settlements near the route high point, and up to two meaningful endpoint places per end. A descending pass is not discarded for lacking a climb. This is a tighter heuristic filter: it can miss an off-route destination, and a tiny list can create false confidence.</p><p>The targeted prompt supplies calculated elevation gaps and warns against duplicate summit/station/area names. Its cycling criteria explicitly preserve independently important lower passes. Applying those changes to every hike caused regressions, including dropping Altmann and over-selecting Gufelstock-area summits. Those trials remain visible below.</p><p>Reversing the targeted prompt’s option order kept ${stableTitles}/17 final titles unchanged, while ${changedAnswers} individual classifications changed. This is a limited stability check, not proof of accuracy. The proposed mountain prompt was not separately order-tested in this round.</p><p>No raw coordinates, tracks, dates, activity identifiers or existing titles go to Jev. Route-derived distances, elevation and progress are included. English names are used where OSM supplies them. No activities changed.</p></details><nav aria-label="Filter outings"><button class="active" data-filter="all">All 17</button><button data-filter="bike">Bike rides</button><button data-filter="hike">Hikes</button><button data-filter="ski">Ski tours</button></nav>${cards.join('')}<footer>Map data © OpenStreetMap contributors · typesafe-ai/jev · <a href="filtered-report.html">Previous Jev–Gemini comparison</a></footer></main><script>document.querySelectorAll('button[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('button[data-filter]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('article').forEach(a=>a.hidden=b.dataset.filter!=='all'&&a.dataset.category!==b.dataset.filter)}));</script></body></html>`;
await writeFile(path.join(root, 'jev-tuning-report.html'), html);
console.log(JSON.stringify(metrics));
