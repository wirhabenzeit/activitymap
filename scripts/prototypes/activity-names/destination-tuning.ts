/** Read-only follow-up experiment; frozen files and baseline responses stay intact. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

import {
  destinationContext,
  focusedVisitationInput,
  visitationInput,
} from './destination-context';
import {
  type ChoiceAnswer,
  assemble,
  deduplicate,
  highPoints,
} from './filtered-context';
import { sportInput } from './jev-tuning-context';
import { type Streams, routePoints } from './matching';
import type { RichContext } from './rich-context';

dotenv.config({ quiet: true });
const option = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(
  option('directory') ?? 'output/activity-name-prototype/holdout-20261022',
);
const mode = option('mode') ?? 'visitation';
if (
  !['filter', 'visitation', 'reversed', 'focused', 'focused-reversed'].includes(
    mode,
  )
)
  throw new Error('Unknown experiment mode');
const label = option('run') ?? `jev-destinations-${mode}-v1`;
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid run label');
const selected = option('samples')?.split(',').map(Number);
const live = process.argv.includes('--live'),
  replay = process.argv.includes('--replay');
const dir = path.join(root, 'filtered', label);
await mkdir(dir, { recursive: true });
const read = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, 'utf8')) as T;
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const model = 'typesafe-ai/jev';
const key = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_AI_GATEWAY_KEY;
if (live && !key) throw new Error('No configured Gateway key');
const sourceFiles = ['destination-context.ts', 'destination-tuning.ts'];
await writeFile(
  path.join(dir, 'protocol.json'),
  JSON.stringify(
    {
      mode,
      model,
      createdAt: new Date().toISOString(),
      sourceHashes: Object.fromEntries(
        await Promise.all(
          sourceFiles.map(
            async (f) =>
              [
                f,
                createHash('sha256')
                  .update(
                    await readFile(
                      path.join('scripts/prototypes/activity-names', f),
                    ),
                  )
                  .digest('hex'),
              ] as const,
          ),
        ),
      ),
      rules:
        'One shared policy; no original activity titles or IDs in model requests. Follow-up tuning on known examples, not held-out accuracy.',
    },
    null,
    2,
  ),
);
if (live) {
  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  const catalog = (await response.json()) as { data: { id: string }[] };
  if (!catalog.data.some((m) => m.id === model))
    throw new Error('Model absent from live catalog');
  await writeFile(
    path.join(dir, 'catalog.json'),
    JSON.stringify(catalog, null, 2),
  );
}
const base = await read<{
  results: {
    activity: { id: string };
    candidates: { lat: number; lon: number }[];
    error?: string;
  }[];
}>(path.join(root, 'results.json'));
const results: object[] = [];
for (const [i, b] of base.results.entries()) {
  if (selected && !selected.includes(i + 1)) continue;
  const sample = `sample_${i + 1}`,
    file = (suffix: string) => path.join(dir, `${sample}-${suffix}.json`);
  try {
    if (b.error) throw new Error(`Map input failed: ${b.error}`);
    const rich = await read<RichContext>(
      path.join(root, 'rich/contexts', `${sample}.json`),
    );
    const stream = await read<Streams>(
      path.join(root, 'routes', `${b.activity.id}.json`),
    );
    const unique = deduplicate(rich, b.candidates);
    const { context, audit } = destinationContext({
      ...unique.context,
      highPoints: highPoints(routePoints(stream).points),
    });
    const input =
      mode === 'filter'
        ? sportInput(context)
        : mode.startsWith('focused')
          ? focusedVisitationInput(context, mode === 'focused-reversed')
          : visitationInput(context, mode === 'reversed');
    const body = { model, ...input },
      requestHash = hash(body);
    await writeFile(
      path.join(dir, `${sample}.json`),
      JSON.stringify(context, null, 2),
    );
    await writeFile(
      file('audit'),
      JSON.stringify({ ...audit, merged: unique.merged }, null, 2),
    );
    await writeFile(
      file('request'),
      JSON.stringify({ endpoint: '/v1/evaluate', requestHash, body }, null, 2),
    );
    if (!live && !replay) {
      console.log(
        JSON.stringify({
          sample,
          before: audit.previousCount,
          after: context.features.length,
          added: audit.retained
            .filter((r) => r.reason !== 'previous shortlist')
            .map((r) => context.features.find((f) => f.key === r.key)?.name),
        }),
      );
      continue;
    }
    let saved:
      | { requestHash: string; elapsedMs: number; raw: Record<string, unknown> }
      | undefined;
    try {
      saved = await read<typeof saved>(file('response'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (!saved) {
      if (!live) throw new Error('No saved response');
      const start = Date.now();
      const response = await fetch('https://ai-gateway.vercel.sh/v1/evaluate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) {
        await writeFile(
          file('error'),
          JSON.stringify(
            {
              status: response.status,
              message: (await response.text()).replaceAll(key!, '[redacted]'),
            },
            null,
            2,
          ),
        );
        throw new Error(`HTTP ${response.status}`);
      }
      saved = {
        requestHash,
        elapsedMs: Date.now() - start,
        raw: (await response.json()) as Record<string, unknown>,
      };
      await writeFile(file('response'), JSON.stringify(saved, null, 2));
    }
    if (saved.requestHash !== requestHash)
      throw new Error('Cached response request mismatch; use a new run label');
    const answers = saved.raw.answers as Record<string, ChoiceAnswer>;
    const usage = saved.raw.usage as {
      cost?: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    const metadata = saved.raw.providerMetadata as
      { gateway?: { cost?: string } } | undefined;
    const result = {
      sample,
      model: saved.raw.model,
      requestHash,
      contextHash: hash(context),
      candidateCount: context.features.length,
      elapsedMs: saved.elapsedMs,
      cost: usage.cost ?? Number(metadata?.gateway?.cost ?? 0),
      inputTokens: usage.inputTokens,
      answers,
      ...assemble(context, input.questions, answers),
    };
    await writeFile(file('result'), JSON.stringify(result, null, 2));
    results.push(result);
    console.log(
      JSON.stringify({
        sample,
        title: result.title,
        candidates: result.candidateCount,
        elapsedMs: result.elapsedMs,
        cost: result.cost,
      }),
    );
  } catch (e) {
    const failure = { sample, error: (e as Error).message };
    results.push(failure);
    console.log(JSON.stringify(failure));
  }
  if (live || replay)
    await writeFile(
      path.join(dir, 'summary.json'),
      JSON.stringify({ model, mode, results }, null, 2),
    );
}
