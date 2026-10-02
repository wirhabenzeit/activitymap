import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const repo = resolve(import.meta.dirname, '..');
const [output, library, scenes = '', variants = '', simulator = ''] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(join(repo, 'shared/gallery-scenarios.json')));
for (const [filter, values] of [[scenes, manifest.scenarios.map((s) => s.id)], [variants, manifest.variants.map((v) => v.name)]]) {
  for (const name of filter ? filter.split(',') : []) if (!values.includes(name)) throw new Error(`Unknown gallery selection: ${name}`);
}
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const fixture = readFileSync(library);
const ids = new Set(JSON.parse(fixture).activities.map((a) => Number(a.id)));
for (const s of manifest.scenarios.filter((s) => !scenes || scenes.split(',').includes(s.id))) {
  for (const id of [...s.selectedIDs, ...(s.detailID ? [s.detailID] : [])]) if (!ids.has(id)) throw new Error(`Missing activity ${id} for ${s.id}`);
}
// Content-based: includes uncommitted Swift/project/asset edits, but excludes runtime
// fixtures so changing scenarios does not force a native rebuild.
const sources = git('ls-files', '--cached', '--others', '--exclude-standard', 'ios').split('\n')
  .filter((p) => /\.(swift|pbxproj|xcscheme|xcconfig)$|Package.resolved$|\.xcassets\//.test(p)).sort();
const build = createHash('sha256').update(simulator).update(process.env.DEVELOPER_DIR || '');
for (const file of sources) build.update(file).update(readFileSync(join(repo, file)));
const run = { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'),
  fixtureHash: createHash('sha256').update(fixture).digest('hex'), library,
  scenarios: scenes ? scenes.split(',') : manifest.scenarios.map((s) => s.id),
  variants: variants ? variants.split(',') : manifest.variants.map((v) => v.name),
  buildHash: build.digest('hex'), createdAt: new Date().toISOString() };
writeFileSync(join(output, 'run.json'), JSON.stringify(run, null, 2));
console.log(`${run.fixtureHash} ${run.commit} ${run.buildHash}`);
