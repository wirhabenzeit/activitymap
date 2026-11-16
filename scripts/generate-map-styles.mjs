import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { buildStyle, profiles } from '../shared/map-styles/build-styles.mjs';

const root = new URL('../shared/map-styles/', import.meta.url);
const readJSON = async (url) => JSON.parse(await readFile(url, 'utf8'));
const upstream = Object.fromEntries(
  await Promise.all(
    [...new Set(Object.values(profiles).map((profile) => profile.base))].map(
      async (base) => [
        base,
        await readJSON(new URL(`upstream/${base}.json`, root)),
      ],
    ),
  ),
);
const trails = await readJSON(new URL('outdoor-trail-paint.json', root));
const check = process.argv.includes('--check');
if (!check) await mkdir(new URL('generated/', root), { recursive: true });
for (const id of Object.keys(profiles)) {
  const expected = `${JSON.stringify(buildStyle(id, upstream, trails), null, 2)}\n`;
  const file = new URL(`generated/${id}.json`, root);
  if (check) {
    if ((await readFile(file, 'utf8')) !== expected)
      throw new Error(`Regenerate prototype style: ${id}`);
  } else await writeFile(file, expected);
}
console.log(
  `${check ? 'Checked' : 'Generated'} ${Object.keys(profiles).length} prototype styles`,
);
