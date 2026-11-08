import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { buildOpenApiDocument } from '../src/contracts/v1/openapi';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'openapi', 'v1.json');
const document = buildOpenApiDocument();
const generated = await format(JSON.stringify(document, null, 2), {
  ...(await resolveConfig(outPath)),
  filepath: outPath,
});
writeFileSync(outPath, generated);
console.log(`Wrote ${outPath}`);
