import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Candidate, MatchResult, Point } from './matching';

type Result = MatchResult & {
  activity: {
    id: string;
    name: string;
    category: string;
    start_date: string;
    distance: number;
    total_elevation_gain: number;
  };
  route: Point[];
  profile: Point[];
  queryMs: number;
  pointCount: number;
  error?: string;
};
const directory = path.resolve(
  process.argv[2] ?? 'output/activity-name-prototype',
);
const data = JSON.parse(
  await readFile(path.join(directory, 'results.json'), 'utf8'),
) as { results: Result[]; generatedAt: string };
type ModelReport = {
  requestedModel: string;
  elapsedMs: number | null;
  runName?: string;
  promptVersion?: string;
  contextHash?: string;
  usage: { cost?: number };
  suggestions: {
    activityId: string;
    title: string | null;
    rawTitle?: string | null;
    selectedKeys?: string[];
    format?: string;
    explanation: string;
    validationErrors?: string[];
  }[];
};
let modelReport: ModelReport | undefined;
let reviewNotes: Record<string, { assessment: string; note: string }> = {};
try {
  modelReport = JSON.parse(
    await readFile(path.join(directory, 'model-results.json'), 'utf8'),
  ) as ModelReport;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
try {
  reviewNotes = JSON.parse(
    await readFile(path.join(directory, 'review-notes.json'), 'utf8'),
  ) as typeof reviewNotes;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const experiments: ModelReport[] = [];
let experimentNotes: Record<string, string> = {};
try {
  const runs = await readdir(path.join(directory, 'runs'));
  for (const run of runs.sort()) {
    try {
      experiments.push(
        JSON.parse(
          await readFile(
            path.join(directory, 'runs', run, 'model-results.json'),
            'utf8',
          ),
        ) as ModelReport,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  try {
    experimentNotes = JSON.parse(
      await readFile(path.join(directory, 'experiment-notes.json'), 'utf8'),
    ) as Record<string, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const highlightedRun =
  experiments.find((r) => r.runName === 'flash-v3') ??
  experiments.find((r) => r.runName === 'sonnet-v3');
if (highlightedRun) modelReport = highlightedRun;
const escape = (value: string | number | null | undefined) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const rounded = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n)
    ? '—'
    : Math.round(n).toLocaleString('en');
function diagram(result: Result) {
  const { route, profile, selected } = result;
  const cos = Math.cos((route[0]!.lat * Math.PI) / 180);
  const xs = route.map((p) => p.lon * cos),
    ys = route.map((p) => p.lat);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.min(450 / (maxX - minX || 1), 215 / (maxY - minY || 1));
  const x = (p: { lon: number }) => 25 + (p.lon * cos - minX) * scale;
  const y = (p: { lat: number }) => 240 - (p.lat - minY) * scale;
  const markers = selected
    .map(
      (c) =>
        `<circle cx="${x(c)}" cy="${y(c)}" r="5" fill="#cb4c20"><title>${escape(c.name)}</title></circle>`,
    )
    .join('');
  const maxKm = profile.at(-1)!.km;
  const altitudes = profile.flatMap((p) =>
    p.altitude === undefined ? [] : [p.altitude],
  );
  const minZ = Math.min(...altitudes),
    maxZ = Math.max(...altitudes);
  const px = (km: number) => 45 + (km / maxKm) * 420;
  const py = (alt: number) => 220 - ((alt - minZ) / (maxZ - minZ || 1)) * 170;
  return `<div class="diagrams"><figure><svg viewBox="0 0 500 270" role="img" aria-label="Recorded route, north up, with suggested destinations"><polyline points="${route.map((p) => `${x(p)},${y(p)}`).join(' ')}" fill="none" stroke="#237b75" stroke-width="2.5"/>${markers}<circle cx="${x(route[0]!)}" cy="${y(route[0]!)}" r="4" fill="#162b2b"/><text x="475" y="25">N ↑</text></svg><figcaption>Route · orange dots are suggested features</figcaption></figure><figure><svg viewBox="0 0 500 270" role="img" aria-label="Elevation profile with selected features"><text x="5" y="35">${rounded(maxZ)} m</text><text x="5" y="225">${rounded(minZ)} m</text><polyline points="${profile
    .filter((p) => p.altitude !== undefined)
    .map((p) => `${px(p.km)},${py(p.altitude!)}`)
    .join(' ')}" fill="none" stroke="#237b75" stroke-width="2"/>${selected
    .filter((c) => c.altitude !== undefined)
    .map(
      (c) =>
        `<circle cx="${px(c.km)}" cy="${py(c.altitude!)}" r="5" fill="#cb4c20"><title>${escape(c.name)}</title></circle>`,
    )
    .join(
      '',
    )}<text x="45" y="253">0 km</text><text x="420" y="253">${maxKm.toFixed(1)} km</text></svg><figcaption>Elevation · positions measured along the GPS route</figcaption></figure></div>`;
}
function candidateRow(c: Candidate, chosen: boolean) {
  return `<tr><td><a href="https://www.openstreetmap.org/${escape(c.id)}" target="_blank" rel="noreferrer">${escape(c.name)}</a>${chosen ? ' <strong>✓</strong>' : ''}</td><td>${escape(c.kind)}</td><td>${rounded(c.distanceM)} m</td><td>${rounded(c.elevationDifferenceM)} m</td><td>${escape(c.reason)}</td></tr>`;
}
function comparison(activityId: string) {
  if (!experiments.length) return '';
  return `<details><summary>Compare all ${experiments.length} model/prompt runs</summary><div class="table-wrap"><table><thead><tr><th>Run</th><th>Model selection</th><th>Validation / explanation</th></tr></thead><tbody>${experiments
    .map((run) => {
      const s = run.suggestions.find(
        (suggestion) => suggestion.activityId === activityId,
      );
      if (!s) return '';
      return `<tr><td>${escape(run.runName)}</td><td><strong>${escape(s.rawTitle ?? 'Abstain')}</strong><br>${escape(s.format)}${s.rawTitle !== s.title ? `<br>After validation/order: ${escape(s.title ?? 'rejected')}` : ''}${s.validationErrors?.some((e) => e.includes('Unknown')) ? `<br>Returned keys: ${escape(s.selectedKeys?.join(', '))}` : ''}</td><td>${s.validationErrors?.length ? `<p class="warning">${escape(s.validationErrors.join('; '))}</p>` : ''}${escape(s.explanation)}</td></tr>`;
    })
    .join('')}</tbody></table></div></details>`;
}
const experimentSummary = experiments.length
  ? `<section class="experiment"><h2>Stronger models &amp; English names</h2><p>All runs below use the same ${experiments[0]!.suggestions.length} outings and enriched OSM context (including English/international names and map classifications). No original activity titles, coordinates, IDs or GPS tracks enter model requests. v1 = original prompt; v2 = explicit decision rules; v3 = place selection only, with ordering and formatting handled locally. This is a development comparison, not a held-out benchmark. Each configuration ran once.</p><p>English labels come directly from OSM <code>name:en</code>, then <code>int_name</code>, then the original name. Thus Нарын → Naryn and Өрүк-Там → Örük-Tam. Unsupported translations are not invented.</p><div class="table-wrap"><table><thead><tr><th>Run / model</th><th>Cost (17 outings)</th><th>Rejected outputs</th><th>Assessment</th></tr></thead><tbody>${experiments.map((run) => `<tr><td><strong>${escape(run.runName)}</strong><br>${escape(run.requestedModel)}</td><td>$${run.usage.cost?.toFixed(6) ?? 'unavailable'}</td><td>${run.suggestions.filter((s) => s.validationErrors?.length).length}</td><td>${escape(experimentNotes[run.runName ?? ''] ?? 'See individual outputs below.')}</td></tr>`).join('')}</tbody></table></div><p>Total for these ${experiments.length} requests: <strong>$${experiments.reduce((sum, run) => sum + (run.usage.cost ?? 0), 0).toFixed(6)}</strong>. Rejected outputs count mechanical contract violations, not naming quality. Missing or extra destinations can pass validation. Raw model choices and rejection reasons remain visible in each card.</p></section>`
  : '';
const cards = data.results
  .map(
    (r) =>
      `<article data-category="${escape(r.activity.category)}"><div class="meta">${escape(r.activity.category)} · ${escape(r.activity.start_date)} · ${(r.activity.distance / 1000).toFixed(1)} km · ↑ ${rounded(r.activity.total_elevation_gain)} m</div><div class="names"><div><small>Current name · withheld from matching</small><h2>${escape(r.activity.name)}</h2></div><div><small>Geometry rules</small><h2>${escape(r.title ?? 'No confident suggestion')}</h2>${r.confidence ? `<span class="badge ${r.confidence}">${r.confidence} confidence</span>` : ''}</div>${modelReport ? `<div><small>${highlightedRun ? `Selection model · ${escape(highlightedRun.runName)}` : 'Tiny model'} · ${escape(modelReport.requestedModel)}</small><h2>${escape(modelReport.suggestions.find((m) => m.activityId === r.activity.id)?.title ?? 'No confident suggestion')}</h2></div>` : ''}</div>${reviewNotes[r.activity.id] ? `<div class="review"><strong>Geometry review: ${escape(reviewNotes[r.activity.id]!.assessment)}</strong><p>${escape(reviewNotes[r.activity.id]!.note)}</p></div>` : ''}${
        r.error
          ? `<p>${escape(r.error)}</p>`
          : `${diagram(r)}<p class="evidence">${r.selected.map((c) => `${escape(c.name)}: ${rounded(c.distanceM)} m from route${c.elevationDifferenceM === undefined ? '' : `, ${rounded(c.elevationDifferenceM)} m elevation difference`}`).join(' · ') || 'No summit or pass selected.'}</p>${r.warnings.map((w) => `<p class="warning">${escape(w)}</p>`).join('')}<details><summary>Inspect nearby features (${r.candidates.length})</summary><div class="table-wrap"><table><thead><tr><th>OSM feature</th><th>Type</th><th>From route</th><th>Route − OSM elevation</th><th>Evidence</th></tr></thead><tbody>${r.candidates
              .filter(
                (c) =>
                  c.distanceM < 1000 || r.selected.some((s) => s.id === c.id),
              )
              .sort(
                (a, b) =>
                  Number(r.selected.some((s) => s.id === b.id)) -
                    Number(r.selected.some((s) => s.id === a.id)) ||
                  a.distanceM - b.distanceM,
              )
              .slice(0, 40)
              .map((c) =>
                candidateRow(
                  c,
                  r.selected.some((s) => s.id === c.id),
                ),
              )
              .join('')}</tbody></table></div></details>`
      }${comparison(r.activity.id)}<p class="foot"><a href="https://www.strava.com/activities/${escape(r.activity.id)}" target="_blank" rel="noreferrer">Open activity</a>${r.pointCount ? ` · ${r.pointCount.toLocaleString('en')} GPS samples` : ''}${r.queryMs ? ` · OSM query ${(r.queryMs / 1000).toFixed(1)} s` : ''}</p></article>`,
  )
  .join('');
const assessmentCounts = new Map<string, number>();
for (const result of data.results) {
  const assessment = reviewNotes[result.activity.id]?.assessment;
  if (assessment)
    assessmentCounts.set(
      assessment,
      (assessmentCounts.get(assessment) ?? 0) + 1,
    );
}
const assessmentSummary = [...assessmentCounts]
  .map(([assessment, count]) => `${count} ${escape(assessment.toLowerCase())}`)
  .join(' · ');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity naming · OSM prototype</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f5f2;color:#18332e;font:16px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:48px 24px}h1{font-size:40px;letter-spacing:-1.5px;margin:0 0 12px}h2{font-size:22px;line-height:1.3;margin:7px 0 12px}header p{max-width:850px;color:#53665f}nav{display:flex;flex-wrap:wrap;gap:8px;margin:28px 0}button{padding:10px 18px;border:1px solid #b9cec4;border-radius:22px;background:white;color:inherit;cursor:pointer;font:inherit}button.active{background:#183f35;color:white}.experiment{background:white;padding:24px;border-radius:16px;margin:24px 0}.experiment table{font-size:13px}article{background:white;border:1px solid #dce5df;border-radius:16px;padding:28px;margin:0 0 24px}.meta,small,.foot{color:#61736c;font-size:13px}.meta{text-transform:uppercase;letter-spacing:1px;margin-bottom:16px}.names{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.review{padding:14px 18px;margin-top:18px;border-left:3px solid #d4aa62;background:#faf6ed;font-size:14px}.review p{margin:4px 0}.badge{border-radius:10px;padding:3px 10px;font-size:12px;background:#eef1ee}.high{background:#dcefe2}.medium{background:#fff0ce}.low{background:#fbe5da}.diagrams{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}figure{margin:0;background:#f6f8f5;border-radius:12px;padding:12px}svg{width:100%;height:auto}svg text{font:11px system-ui;fill:#687c70}figcaption{font-size:12px;color:#61736c;text-align:center}.evidence{font-size:14px}.warning{color:#95551b;font-size:14px}details{border-top:1px solid #e3ebe5;padding-top:14px;margin-top:16px}summary{cursor:pointer}.table-wrap{overflow:auto}table{border-collapse:collapse;font-size:12px;width:100%;margin-top:15px}th,td{text-align:left;padding:8px;border-bottom:1px solid #edf0ed}a{color:#286b54}.foot{margin-bottom:0}footer{font-size:13px;color:#61736c}@media(max-width:650px){main{padding:24px 14px}h1{font-size:30px}.names,.diagrams{grid-template-columns:1fr}article{padding:20px}}</style></head><body><main><header><p>ACTIVITYMAP / EXPERIMENT</p><h1>Names grounded in the route.</h1><p>${data.results.length} real outings. OSM peaks, passes and destinations matched to GPS geometry and elevation. Existing names are shown only for comparison; they never enter the matcher. No activities were changed.</p><p>Sample: outings since 2023, at least 5 km for hikes/ski tours and 50 km for rides. Latest two, highest-ascent two and a fixed random two per category, with overlap removed. This is an exploratory sample used to tune the prototype, not an independent accuracy benchmark. Confidence labels describe geographic evidence, not title quality; they are heuristics, not probabilities.</p>${modelReport && !experiments.length ? `<p><strong>Model comparison:</strong> ${escape(modelReport.requestedModel)} received only a shortlist of OSM names/types/aliases, OSM elevations, and role/order labels. No coordinates, GPS tracks, dates, activity IDs or existing names. The completed batch cost $${modelReport.usage.cost?.toFixed(6) ?? 'unavailable'} and took ${((modelReport.elapsedMs ?? 0) / 1000).toFixed(1)} s. Its mistakes are shown as returned, not silently replaced with the baseline.</p>` : ''}${assessmentSummary ? `<p><strong>Original geometry assessment:</strong> ${assessmentSummary}. These are manual judgments from this development sample, not a measured accuracy rate.</p>` : ''}</header>${experimentSummary}<nav aria-label="Filter activities"><button class="active" data-filter="all">All ${data.results.length}</button><button data-filter="ski">Ski tours</button><button data-filter="hike">Hikes</button><button data-filter="bike">Bike rides</button></nav>${cards}<footer>Geographic features © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, ODbL. Local report generated ${escape(data.generatedAt)}. Route diagrams are schematic and not navigation maps. Generic activity names provide no ground truth; user review is required.</footer></main><script>document.querySelectorAll('button[data-filter]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('button[data-filter]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('article').forEach(a=>a.hidden=button.dataset.filter!=='all'&&a.dataset.category!==button.dataset.filter)}))</script></body></html>`;
await writeFile(path.join(directory, 'report.html'), html);
console.log(path.join(directory, 'report.html'));
