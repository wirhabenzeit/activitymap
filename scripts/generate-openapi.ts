import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../src/contracts/v1/openapi';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'openapi', 'v1.json');
const document = buildOpenApiDocument();
writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
