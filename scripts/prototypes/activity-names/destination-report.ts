import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FilteredContext } from './filtered-context';

const root = path.resolve('output/activity-name-prototype');
const fresh = path.join(root, 'holdout-20261022');
type Result = {
  sample: string;
  title: string | null;
  error?: string;
  candidateCount: number;
  elapsedMs: number;
  cost: number;
  requestHash: string;
  answers: Record<string, { choice: string }>;
};
type Item = { activity: { id: string; name: string; category: string } };
const read = async <T>(p: string): Promise<T> =>
  JSON.parse(await readFile(p, 'utf8')) as T;
const get = async (dir: string, run: string) =>
  (
    await read<{ results: Result[] }>(
      path.join(dir, 'filtered', run, 'summary.json'),
    )
  ).results;
const filter = 'jev-destinations-filter-v1',
  focused = 'jev-destinations-focused-v2',
  broad = 'jev-destinations-visitation-v1',
  reversed = 'jev-destinations-focused-reversed-v2';
const freshBase = (
  await read<{ results: Item[] }>(path.join(fresh, 'results.json'))
).results;
const oldBase = (
  await read<{ results: Item[] }>(path.join(root, 'results.json'))
).results;
const baseline = await get(fresh, 'jev-frozen-holdout-v1'),
  filtered = await get(fresh, filter),
  tuned = await get(fresh, focused),
  first = await get(fresh, broad),
  order = await get(fresh, reversed);
const oldFilter = await get(root, filter),
  oldTuned = await get(root, focused);
const oldBaseline: Result[] = [];
for (const [i, b] of oldBase.entries())
  oldBaseline.push(
    await read<Result>(
      path.join(
        root,
        'filtered',
        b.activity.category === 'bike'
          ? 'jev-minimal-slim-v4'
          : 'jev-slim-control-v3',
        `sample_${i + 1}-result.json`,
      ),
    ),
  );
for (const results of [baseline, filtered, tuned, first, order])
  assert.equal(results.length, 24);
for (const results of [oldFilter, oldTuned, oldBaseline])
  assert.equal(results.length, 17);
const protocol = await read<{ sourceHashes: Record<string, string> }>(
  path.join(fresh, 'protocol.json'),
);
for (const [f, hash] of Object.entries(protocol.sourceHashes))
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join('scripts/prototypes/activity-names', f)))
      .digest('hex'),
    hash,
    'Frozen source changed',
  );
assert.equal(
  new Set([...freshBase, ...oldBase].map((b) => String(b.activity.id))).size,
  41,
);
const notes = await read<Record<string, { status: string; note: string }>>(
  path.join(fresh, 'comparison-notes.json'),
);
const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const median = (a: number[]) => {
  const s = [...a].sort((a, b) => a - b),
    i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i]! : (s[i - 1]! + s[i]!) / 2;
};
const same = (a: Result[], b: Result[]) =>
  a.filter((r, i) => r.title === b[i]!.title).length;
const costs = (a: Result[]) => a.reduce((s, r) => s + r.cost, 0);
const reused = filtered.filter(
  (r, i) => r.requestHash === baseline[i]!.requestHash,
);
const paid = [
  ...filtered.filter((r, i) => r.requestHash !== baseline[i]!.requestHash),
  ...tuned,
  ...first,
  ...order,
  ...oldFilter,
  ...oldTuned,
];
const metrics = {
  fresh: 24,
  original: 17,
  baselineCandidates: baseline.reduce((s, r) => s + r.candidateCount, 0),
  updatedCandidates: filtered.reduce((s, r) => s + r.candidateCount, 0),
  medianCandidates: median(filtered.map((r) => r.candidateCount)),
  focusedMedianMs: median(tuned.map((r) => r.elapsedMs)),
  filterNewCalls: filtered.length - reused.length,
  baselineResponsesReused: reused.length,
  newCalls: paid.length,
  newCost: costs(paid),
  focusedOrderStableTitles: same(tuned, order),
  focusedOrderTotal: 24,
  changedOrderAnswers: tuned.reduce(
    (s, r, i) =>
      s +
      Object.keys(r.answers).filter(
        (k) => r.answers[k]!.choice !== order[i]!.answers[k]!.choice,
      ).length,
    0,
  ),
  originalExactRequestRepeats: oldFilter.filter(
    (r, i) => r.requestHash === oldBaseline[i]!.requestHash,
  ).length,
  originalRepeatedTitlesStable: same(oldBaseline, oldFilter),
  focusedFreshChangesVsFilter: 24 - same(filtered, tuned),
  focusedOriginalChangesVsFilter: 17 - same(oldFilter, oldTuned),
  frozenSourcesUnchanged: true,
};
await writeFile(
  path.join(fresh, 'comparison-metrics.json'),
  JSON.stringify(metrics, null, 2),
);
function suggestion(r: Result) {
  return esc(r.title ?? (r.error ? 'Request failed' : 'No suggestion'));
}
function panel(
  r: Result[],
  label: string,
  dir: string,
  run: string,
  i: number,
) {
  const result = r[i]!;
  return `<section><label>${label}</label><h3>${suggestion(result)}</h3><small>${result.candidateCount} candidates · ${result.elapsedMs} ms</small><p class="links"><a href="${dir}filtered/${run}/${result.sample}-request.json">Request</a> · <a href="${dir}filtered/${run}/${result.sample}-response.json">Response</a></p></section>`;
}
const cards: string[] = [];
for (const [i, b] of freshBase.entries()) {
  const sample = `sample_${i + 1}`,
    n = notes[sample]!;
  const c = await read<FilteredContext>(
    path.join(fresh, 'filtered', filter, `${sample}.json`),
  );
  const before = await read<FilteredContext>(
    path.join(fresh, 'filtered', 'jev-frozen-holdout-v1', `${sample}.json`),
  );
  const oldKeys = new Set(before.features.map((f) => f.key)),
    added = c.features.filter((f) => !oldKeys.has(f.key));
  const rows = c.features
    .map((f) => {
      const e = c.encounters
        .filter((e) => e.feature === f.key)
        .sort(
          (a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity),
        )[0];
      return `<tr><td>${esc(f.name)}${oldKeys.has(f.key) ? '' : ' <b>added</b>'}<br><small>${esc(f.type)} · ${esc(f.place)}</small></td><td>${esc(e?.distanceM ?? '?')} m</td><td>${esc(f.osmElevationM ?? '?')} / ${esc(e?.routeElevationM ?? '?')} m</td><td>${esc(filtered[i]!.answers[f.key + '_visit']?.choice)} → ${esc(tuned[i]!.answers[f.key + '_visit']?.choice)}</td></tr>`;
    })
    .join('');
  cards.push(
    `<article data-set="fresh" data-sport="${b.activity.category}" data-status="${n.status}"><small>FRESH · ${b.activity.category.toUpperCase()} · ${sample}</small><h2>${esc(b.activity.name)}</h2><p class="muted">Existing personal title, withheld from every model request</p><div class="comparison">${panel(baseline, 'Previous version', '', 'jev-frozen-holdout-v1', i)}${panel(filtered, 'Improved filter · existing prompt', '', filter, i)}${panel(tuned, 'Improved filter · focused visit prompt', '', focused, i)}</div><aside class="${n.status}"><strong>${n.status}</strong> · ${esc(n.note)}</aside><details><summary>Evidence, additions and controls</summary><p>Added candidates: ${added.length ? added.map((f) => esc(f.name)).join(' · ') : 'none'}.</p><div class="scroll"><table><thead><tr><th>Candidate</th><th>Closest distance</th><th>Map / track altitude</th><th>Visit: existing → focused</th></tr></thead><tbody>${rows}</tbody></table></div><p>Table shows the horizontally closest encounter for compactness; prompts include separate approaches. Check the full request before drawing a visitation conclusion.</p><p><a href="filtered/${filter}/${sample}.json">All evidence</a> · <a href="filtered/${filter}/${sample}-audit.json">Filter audit</a></p><p>Broader first rewrite: <strong>${suggestion(first[i]!)}</strong> · <a href="filtered/${broad}/${sample}-request.json">Request</a> · <a href="filtered/${broad}/${sample}-response.json">Response</a></p><p>Focused prompt with reversed choice order: <strong>${suggestion(order[i]!)}</strong> · <a href="filtered/${reversed}/${sample}-request.json">Request</a> · <a href="filtered/${reversed}/${sample}-response.json">Response</a></p></details></article>`,
  );
}
for (const [i, b] of oldBase.entries()) {
  const sameRequest = oldBaseline[i]!.requestHash === oldFilter[i]!.requestHash;
  const changedRepeat = oldBaseline[i]!.title !== oldFilter[i]!.title;
  const originalRun =
    b.activity.category === 'bike'
      ? 'jev-minimal-slim-v4'
      : 'jev-slim-control-v3';
  cards.push(
    `<article data-set="original" data-sport="${b.activity.category}"><small>ORIGINAL · ${b.activity.category.toUpperCase()} · sample_${i + 1}</small><h2>${esc(b.activity.name)}</h2><div class="comparison">${panel(oldBaseline, 'Previous saved response', '../', originalRun, i)}${panel(oldFilter, 'Filter policy · fresh request', '../', filter, i)}${panel(oldTuned, 'Focused visitation · fresh request', '../', focused, i)}</div><aside>${sameRequest ? 'The filter policy produces the exact same request as the previous version on this example.' : 'Candidate context differs.'} ${changedRepeat ? 'The fresh identical-request response changed the title. This is baseline service/model variation, not an effect of filtering.' : ''}</aside></article>`,
  );
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity names · destination and visit comparison</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f5f2;color:#193a31;font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;padding:32px 24px;margin:auto}h1{font-size:36px;letter-spacing:-1px;line-height:1.15}h2{font-size:24px}h3{font-size:20px;line-height:1.35;margin:10px 0}.panel,article{background:white;padding:24px;border:1px solid #dce6df;border-radius:16px;margin:24px 0}.comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.stats strong{display:block;font-size:30px}label,small,.muted{font-size:13px;color:#64796c}.links{font-size:12px}aside{padding:14px 18px;border-left:3px solid #b9b38c;background:#f7f6ec;margin:20px 0 0}aside.improved{border-color:#73a084;background:#eef7ef}aside.regression{border-color:#bc805f;background:#fff1e9}a{color:#246d51}summary{cursor:pointer;font-weight:600}details{margin:18px 0 0;border-top:1px solid #e0e8e2;padding-top:16px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;text-align:left;border-bottom:1px solid #e0e8e2;vertical-align:top}.scroll{overflow:auto}nav{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}button,select{font:inherit;border:1px solid #b5cbbb;border-radius:22px;padding:9px 16px;background:white;color:inherit;cursor:pointer}button.active{background:#194b36;color:white}footer{font-size:13px;color:#64796c}@media(max-width:760px){main{padding:20px 14px}.comparison{grid-template-columns:1fr;gap:16px}.stats{grid-template-columns:1fr;gap:12px}h1{font-size:29px}.panel,article{padding:18px}}</style></head><body><main><p>ACTIVITYMAP / FOLLOW-UP EXPERIMENT</p><h1>Better destinations.<br>The same fast naming.</h1><p>The small filter change recovers Stöcklichrüz and Oeschinensee. Visitation wording is a mixed tradeoff, so the recommended next prototype uses the improved filter with the existing prompt.</p><section class="panel"><div class="stats"><div><strong>${metrics.baselineCandidates} → ${metrics.updatedCandidates}</strong><small>Candidates across the 24 fresh activities</small></div><div><strong>${metrics.focusedMedianMs} ms</strong><small>Median focused-prompt request time</small></div><div><strong>${metrics.focusedOrderStableTitles} / 24</strong><small>Focused titles stable under reversed choice order</small></div></div><p><strong>Two useful recoveries, four extra candidates.</strong> Cycling can retain up to two nearby summits at route high points. Hikes can retain up to two closely visited interior hamlets/areas, without requiring them to sit at a high point. The original shortlist and all its destinations are retained. Alp Wildegg remains a personal override rather than a filter requirement.</p><p><strong>The visitation trial is experimental.</strong> The focused wording supplies encounter-specific height differences and explicit mismatch flags. It cleans up Misthufen but loses a plausible Klein Mythen name. The broader first rewrite recovers Schäfler but over-selects elsewhere. No failed trial is hidden.</p><p>These are now development examples, not a held-out accuracy benchmark. Existing titles are preferences and context, not compulsory answers. The user confirms Höch Hund's summit was not reached; abstention or failure to name it is acceptable.</p></section><details class="panel"><summary>Controls, timing and spend</summary><p>${metrics.originalExactRequestRepeats} / 17 original examples produce identical filter requests. Fresh responses retained ${metrics.originalRepeatedTitlesStable} / 17 titles, showing variation even with identical requests. The focused prompt also changes ${metrics.focusedOriginalChangesVsFilter} / 17 original titles versus their fresh filter-control responses.</p><p>Reversing choice order changed ${24 - metrics.focusedOrderStableTitles} / 24 titles and ${metrics.changedOrderAnswers} individual choices. This comparison includes both option-order sensitivity and ordinary response variation; it cannot attribute every difference to option order.</p><p>${metrics.baselineResponsesReused} fresh-set filter responses reuse exact matching baseline request hashes; only ${metrics.filterNewCalls} needed a new request. Broader wording, focused wording, reversed choices and the 17-example repeat/regression controls were live requests. Total new calls: ${metrics.newCalls}; recorded total cost: $${metrics.newCost.toFixed(6)}. The focused prompt's 24 requests cost $${costs(tuned).toFixed(6)}. Model times exclude map lookup and local matching.</p><p>Cached OSM evidence was reused. The Oeschinensee candidate is an existing mapped hamlet name; this trial does not add lake polygons or transliteration. All six frozen baseline source hashes remain unchanged. No activities were renamed.</p><p><a href="comparison-metrics.json">Metrics</a> · <a href="comparison-notes.json">Review notes</a> · <a href="report.html">Original fresh-activity report, with user corrections</a></p></details><nav aria-label="Example set"><button class="active" data-set-filter="fresh">Fresh 24</button><button data-set-filter="original">Original 17 · regression check</button></nav><nav aria-label="Sport"><button class="active" data-sport-filter="all">All sports</button><button data-sport-filter="bike">Bike rides</button><button data-sport-filter="hike">Hikes</button><button data-sport-filter="ski">Ski tours</button></nav>${cards.join('')}<footer>Map data © OpenStreetMap contributors · typesafe-ai/jev · exact requests and all saved responses linked above.</footer></main><script>let currentSet='fresh',currentSport='all';function update(){document.querySelectorAll('article').forEach(a=>a.hidden=a.dataset.set!==currentSet||(currentSport!=='all'&&a.dataset.sport!==currentSport));document.querySelectorAll('[data-set-filter]').forEach(b=>b.classList.toggle('active',b.dataset.setFilter===currentSet));document.querySelectorAll('[data-sport-filter]').forEach(b=>b.classList.toggle('active',b.dataset.sportFilter===currentSport))}document.querySelectorAll('[data-set-filter]').forEach(b=>b.addEventListener('click',()=>{currentSet=b.dataset.setFilter;update()}));document.querySelectorAll('[data-sport-filter]').forEach(b=>b.addEventListener('click',()=>{currentSport=b.dataset.sportFilter;update()}));update();</script></body></html>`;
await writeFile(path.join(fresh, 'destination-comparison.html'), html);
console.log(JSON.stringify(metrics));
