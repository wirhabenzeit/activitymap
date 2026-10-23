import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FilteredContext } from './filtered-context';
import type { Point } from './matching';

const directory = path.resolve(
  process.argv[2] ?? 'output/activity-name-prototype/holdout-20261022',
);
const run = 'jev-frozen-holdout-v1';
const read = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(path.join(directory, file), 'utf8')) as T;
type Base = {
  activity: {
    id: string;
    name: string;
    category: string;
    distance: number;
    total_elevation_gain: number;
    start_date: string;
    outside_swiss_box: boolean;
  };
  profile?: Point[];
  error?: string;
  queryMs?: number;
  warnings?: string[];
};
type Model = {
  sample: string;
  title: string | null;
  warning?: string;
  error?: string;
  format: string;
  elapsedMs: number;
  cost: number;
  candidateCount: number;
  inputTokens: number;
  answers: Record<string, { choice: string }>;
  selectedEvidence: {
    feature: FilteredContext['features'][number];
    encounter?: FilteredContext['encounters'][number];
  }[];
};
type Review = {
  status: 'useful' | 'review' | 'miss' | 'abstain' | 'failure';
  cause: string;
  note: string;
};
const base = (await read<{ results: Base[] }>('results.json')).results;
const models = (
  await read<{ results: Model[] }>(`filtered/${run}/summary.json`)
).results;
const protocol = await read<{ sourceHashes: Record<string, string> }>(
  'protocol.json',
);
const frozen = (
  await Promise.all(
    Object.entries(protocol.sourceHashes).map(
      async ([f, hash]) =>
        createHash('sha256')
          .update(
            await readFile(path.join('scripts/prototypes/activity-names', f)),
          )
          .digest('hex') === hash,
    ),
  )
).every(Boolean);
if (!frozen)
  throw new Error('Frozen algorithm/prompt source changed during holdout');
let reviews: Record<string, Review> = {};
try {
  reviews = await read<Record<string, Review>>('review-notes.json');
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
const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
function profile(base: Base, model?: Model) {
  const points = base.profile?.filter((p) => p.altitude !== undefined) ?? [];
  if (!points.length) return '';
  const low = Math.min(...points.map((p) => p.altitude!)),
    high = Math.max(...points.map((p) => p.altitude!));
  const km = points.at(-1)!.km;
  const x = (fraction: number) => 40 + fraction * 570;
  const y = (alt: number) => 155 - ((alt - low) / (high - low || 1)) * 120;
  const markers = (model?.selectedEvidence ?? [])
    .filter((e) => e.encounter?.routeElevationM != null)
    .map(
      (e) =>
        `<circle cx="${x((e.encounter!.routePercent ?? 0) / 100)}" cy="${y(e.encounter!.routeElevationM!)}" r="5" fill="#b87031"><title>${esc(e.feature.name)}</title></circle>`,
    )
    .join('');
  return `<svg viewBox="0 0 650 185" role="img" aria-label="Recorded elevation profile with selected destinations"><text x="4" y="25">${Math.round(high)} m</text><text x="4" y="173">${Math.round(low)} m</text><polyline points="${points.map((p) => `${x(p.km / km)},${y(p.altitude!)}`).join(' ')}" fill="none" stroke="#26766b" stroke-width="2"/>${markers}<text x="570" y="180">${km.toFixed(1)} km</text></svg>`;
}
const successful = models.filter((m) => !m.error && m.answers);
const attempts = await Promise.all(
  [1, 2, 3].map((i) => read<{ results: Base[] }>(`osm-attempt-${i}.json`)),
);
const osmSuccessfulTimes = attempts.flatMap((a) =>
  a.results.filter((r) => r.queryMs).map((r) => r.queryMs!),
);
const bySport = ['bike', 'hike', 'ski'].map((sport) => ({
  sport,
  ...(Object.fromEntries(
    ['useful', 'review', 'miss', 'abstain', 'failure'].map((status) => [
      status,
      base.filter(
        (b, i) =>
          b.activity.category === sport &&
          reviews[`sample_${i + 1}`]?.status === status,
      ).length,
    ]),
  ) as Record<Review['status'], number>),
}));
const metrics = {
  selected: base.length,
  completed: successful.length,
  modelMedianMs: median(successful.map((m) => m.elapsedMs)),
  modelCost: successful.reduce((s, m) => s + m.cost, 0),
  candidateMedian: median(successful.map((m) => m.candidateCount)),
  candidatesTotal: successful.reduce((s, m) => s + m.candidateCount, 0),
  osmMedianSuccessfulRequestMs: median(osmSuccessfulTimes),
  osmFailedAttempts: attempts.flatMap((a) => a.results).filter((r) => r.error)
    .length,
  sourceHashesUnchanged: frozen,
  bySport,
};
await writeFile(
  path.join(directory, 'metrics.json'),
  JSON.stringify(metrics, null, 2),
);
const summary = `<table><thead><tr><th>Sport</th><th>Useful</th><th>Needs review</th><th>Miss</th><th>Reasonable abstention</th><th>Data/API failure</th></tr></thead><tbody>${bySport.map((s) => `<tr><td>${s.sport}</td><td>${s.useful}</td><td>${s.review}</td><td>${s.miss}</td><td>${s.abstain}</td><td>${s.failure}</td></tr>`).join('')}</tbody></table>`;
const cards: string[] = [];
for (const [i, b] of base.entries()) {
  const sample = `sample_${i + 1}`,
    m = models.find((m) => m.sample === sample),
    review = reviews[sample];
  let c: FilteredContext | undefined;
  try {
    c = await read<FilteredContext>(`filtered/${run}/${sample}.json`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const rows =
    c?.features
      .map((f) => {
        const e = c.encounters
          .filter((e) => e.feature === f.key)
          .sort(
            (a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity),
          )[0];
        return `<tr><td>${esc(f.name)}<br><small>${esc(f.type)} · ${esc(f.place)}</small></td><td>${esc(e?.distanceM ?? '—')} m</td><td>${esc(f.osmElevationM ?? '—')} / ${esc(e?.routeElevationM ?? '—')} m</td><td>${esc(e?.routePercent ?? '—')}%</td><td>${esc(m?.answers?.[`${f.key}_visit`]?.choice)} / ${esc(m?.answers?.[`${f.key}_role`]?.choice)}</td></tr>`;
      })
      .join('') ?? '';
  cards.push(
    `<article data-category="${esc(b.activity.category)}" data-status="${esc(review?.status ?? 'pending')}"><small>${esc(b.activity.category.toUpperCase())} · ${sample} · ${esc(b.activity.start_date)} · ${(b.activity.distance / 1000).toFixed(1)} km · ↑ ${Math.round(b.activity.total_elevation_gain)} m</small><div class="names"><section><label>Existing title · withheld</label><h2>${esc(b.activity.name)}</h2></section><section><label>Frozen Jev version</label><h2>${esc(m?.title ?? (m?.error || b.error ? 'Data/API failure' : 'No suggestion'))}</h2></section></div>${review ? `<aside class="${review.status}"><strong>${esc(review.status)} · ${esc(review.cause)}</strong><p>${esc(review.note)}</p></aside>` : ''}${profile(b, m)}<p class="meta">${m?.answers ? `${m.candidateCount} candidates · ${m.elapsedMs} ms model response · $${m.cost.toFixed(6)}` : esc(m?.error ?? b.error ?? 'Pending')}${m?.warning ? ` · ${esc(m.warning)}` : ''}</p><details><summary>Inspect the candidate evidence and exact request</summary><div class="scroll"><table><thead><tr><th>Place</th><th>From route</th><th>OSM / route elevation</th><th>Progress</th><th>Visit / significance</th></tr></thead><tbody>${rows}</tbody></table></div><p><a href="filtered/${run}/${sample}-request.json">Full prompt</a> · <a href="filtered/${run}/${sample}-response.json">Raw response</a> · <a href="filtered/${run}/${sample}-audit.json">Filter audit</a> · <a href="rich/contexts/${sample}.json">Before filtering</a></p></details></article>`,
  );
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity naming · fresh activity test</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f5f2;color:#193a31;font:16px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:34px 24px}h1{font-size:36px;line-height:1.2;letter-spacing:-1px}h2{font-size:23px;line-height:1.3}.panel,article{background:white;border:1px solid #dce6df;border-radius:16px;padding:24px;margin:24px 0}.names,.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.stats strong{display:block;font-size:30px}.meta,small,label{font-size:13px;color:#64796c}aside{padding:14px 18px;border-left:3px solid #cba35d;background:#fcf6e9}aside p{margin:4px 0}aside.useful{background:#eef7ef;border-color:#74a081}aside.miss,aside.failure{background:#fff0eb;border-color:#c47b60}svg{width:100%;max-height:190px;margin-top:18px}svg text{font-size:12px;fill:#61766a}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:10px;border-bottom:1px solid #e0e8e2;vertical-align:top}details{border-top:1px solid #e0e8e2;padding-top:14px;margin-top:14px}summary{cursor:pointer;font-weight:600}a{color:#246d51}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #b5cbbb;border-radius:22px;padding:9px 18px;background:white;color:inherit;cursor:pointer}button.active{background:#194b36;color:white}footer{font-size:13px;color:#64796c}@media(max-width:700px){main{padding:20px 14px}.names,.stats{grid-template-columns:1fr;gap:6px}h1{font-size:29px}.panel,article{padding:18px}}</style></head><body><main><header><p>ACTIVITYMAP / FRESH ACTIVITY TEST</p><h1>Does the fast version generalize?</h1><p>24 new activity IDs: eight bike rides, eight hikes and eight ski tours. The prompt and filtering code were frozen before selection and were not tuned on these results.</p><p><strong>Fast, but generalization is mixed.</strong> Clear summit/pass matches work well. The shortlist drops some meaningful destinations, and mountain visitation decisions remain inconsistent. Review the failures before further tuning.</p></header><section class="panel"><div class="stats"><div><strong>${metrics.completed} / ${metrics.selected}</strong><small>Model results completed</small></div><div><strong>${metrics.modelMedianMs} ms</strong><small>Median model request time · OSM lookup is extra</small></div><div><strong>${metrics.candidateMedian} candidates</strong><small>Median shortlist</small></div><div><strong>$${metrics.modelCost.toFixed(4)}</strong><small>Recorded model cost</small></div></div><p class="meta">Map lookups: ${metrics.osmFailedAttempts} failed attempts before all 24 succeeded on the same endpoints. Median successful lookup: ${(metrics.osmMedianSuccessfulRequestMs / 1000).toFixed(1)} s, excluding failed waits. The model timing is not end-to-end latency.</p><div class="scroll">${summary}</div><p>These are qualitative judgments of geographic support and usefulness, not exact-title accuracy. “Needs review” includes extra names, uncertain importance or insufficient evidence; “miss” includes missing candidates and misleading suggestions. Generic existing titles provide no destination ground truth. Revisited destinations are possible even though all activity IDs are new.</p></section><details class="panel"><summary>Frozen protocol and selection</summary><p>All 17 development IDs were excluded. Per sport: latest outing, highest-ascent outing, up to two seeded selections outside an approximate Swiss bounding box, then seeded random fill to eight. Since 2023; hikes/ski tours over 5 km; bike rides over 50 km. Names did not influence selection. The bounding box is a sampling aid, not a country classifier.</p><p>Frozen version: sport-slim. Cycling uses the targeted prompt; hiking/ski use the original mountain prompt, all with the smaller candidate set. Source hash verification: ${frozen ? 'unchanged' : 'FAILED'}. No raw tracks, dates, activity IDs or current titles enter model requests; derived geographic evidence is sent. No activities were renamed.</p><p><a href="protocol.json">Protocol and source hashes</a> · <a href="selection.sql">Selection query</a> · <a href="sample.json">Selected activities</a></p></details><nav aria-label="Filter outings"><button class="active" data-filter="all">All 24</button><button data-filter="bike">Bike rides</button><button data-filter="hike">Hikes</button><button data-filter="ski">Ski tours</button></nav>${cards.join('')}<footer>Map data © OpenStreetMap contributors · typesafe-ai/jev · <a href="../jev-tuning-report.html">Development experiment</a></footer></main><script>document.querySelectorAll('button[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('button[data-filter]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('article').forEach(a=>a.hidden=b.dataset.filter!=='all'&&a.dataset.category!==b.dataset.filter)}));</script></body></html>`;
await writeFile(path.join(directory, 'report.html'), html);
console.log(JSON.stringify(metrics));
