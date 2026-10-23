/** Rich-evidence experiment. Uses cached OSM/route data; live model calls require --live. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

import { type MatchResult, type Streams, routePoints } from './matching';
import {
  type RichContext,
  richContext,
  richPrompt,
  richTsv,
} from './rich-context';

dotenv.config({ quiet: true });
const directory = path.resolve(
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'output/activity-name-prototype',
);
const option = (name: string) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const format = option('format') ?? 'tsv';
if (!['tsv', 'json'].includes(format)) throw new Error('Invalid format');
const label = option('run') ?? `flash-rich-${format}`;
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid run label');
const output = path.join(directory, 'rich', label);
await mkdir(output, { recursive: true });
const model = option('model') ?? 'google/gemini-3-flash';
const live = process.argv.includes('--live');
const maxTokens = Number(option('max-tokens') ?? 16000);
if (!Number.isInteger(maxTokens) || maxTokens < 1000 || maxTokens > 32000)
  throw new Error('Invalid output allowance');
const prepare = process.argv.includes('--prepare');
const selected = option('samples')?.split(',').map(Number);
const base = JSON.parse(
  await readFile(path.join(directory, 'results.json'), 'utf8'),
) as {
  results: (MatchResult & {
    activity: { id: string; category: string };
    error?: string;
  })[];
};
const contextDirectory = path.join(directory, 'rich', 'contexts');
await mkdir(contextDirectory, { recursive: true });
const samples: { sample: string; index: number; context: RichContext }[] = [];
for (const [index, result] of base.results.entries()) {
  if (result.error || (selected && !selected.includes(index + 1))) continue;
  const sample = `sample_${index + 1}`;
  const file = path.join(contextDirectory, `${sample}.json`);
  let context: RichContext;
  if (prepare) {
    const { points } = routePoints(
      JSON.parse(
        await readFile(
          path.join(directory, 'routes', `${result.activity.id}.json`),
          'utf8',
        ),
      ) as Streams,
    );
    context = richContext(result.activity.category, result.candidates, points);
    await writeFile(file, JSON.stringify(context, null, 2));
    await writeFile(
      path.join(contextDirectory, `${sample}.tsv`),
      richTsv(context),
    );
    console.log(
      JSON.stringify({
        sample,
        candidates: context.features.length,
        encounters: context.encounters.length,
        tsvCharacters: richTsv(context).length,
        jsonCharacters: JSON.stringify(context).length,
      }),
    );
  } else context = JSON.parse(await readFile(file, 'utf8')) as RichContext;
  samples.push({ sample, index, context });
}
if (!live) process.exit(0);
const key = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_AI_GATEWAY_KEY;
if (!key) throw new Error('No configured AI Gateway key');
const catalog = (await fetch('https://ai-gateway.vercel.sh/v1/models', {
  signal: AbortSignal.timeout(20000),
}).then((r) => r.json())) as { data: { id: string; tags?: string[] }[] };
if (
  !catalog.data.some(
    (m) => m.id === model && m.tags?.includes('structured-output'),
  )
)
  throw new Error('Model absent or lacks structured output');
const schema = z.object({
  selectedKeys: z.array(z.string()),
  encounterKeys: z.array(z.string()),
  format: z.enum(['destinations', 'point_to_point', 'loop', 'abstain']),
  explanation: z.string(),
});
type Response = {
  id: string;
  model: string;
  choices: { message: { content: string }; finish_reason: string }[];
  usage: { cost?: number; prompt_tokens: number; completion_tokens: number };
  provider_metadata?: unknown;
};
const results: object[] = [];
// Two independent per-activity requests at a time, with results persisted immediately.
let next = 0;
async function worker() {
  while (next < samples.length) {
    const { sample, index, context } = samples[next++]!;
    const input = format === 'tsv' ? richTsv(context) : JSON.stringify(context);
    const body = {
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: richPrompt },
        { role: 'user', content: input },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'activity_name',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              selectedKeys: { type: 'array', items: { type: 'string' } },
              encounterKeys: { type: 'array', items: { type: 'string' } },
              format: {
                type: 'string',
                enum: ['destinations', 'point_to_point', 'loop', 'abstain'],
              },
              explanation: { type: 'string' },
            },
            required: [
              'selectedKeys',
              'encounterKeys',
              'format',
              'explanation',
            ],
            additionalProperties: false,
          },
        },
      },
    };
    const requestHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const resultFile = path.join(output, `${sample}-result.json`);
    try {
      const saved = JSON.parse(await readFile(resultFile, 'utf8')) as {
        requestHash: string;
      };
      if (saved.requestHash !== requestHash)
        throw new Error('Run inputs changed; choose a new run label');
      results.push(saved);
      console.log(`${sample}: reused saved result`);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeFile(
      path.join(output, `${sample}-request.json`),
      JSON.stringify(body, null, 2),
    );
    const start = Date.now();
    try {
      const response = await fetch(
        'https://ai-gateway.vercel.sh/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90000),
        },
      );
      if (!response.ok) {
        await writeFile(
          path.join(output, `${sample}-error.json`),
          JSON.stringify(
            {
              status: response.status,
              body: (await response.text()).replaceAll(key!, '[redacted]'),
            },
            null,
            2,
          ),
        );
        throw new Error(`HTTP ${response.status}`);
      }
      const raw = (await response.json()) as Response;
      const elapsedMs = Date.now() - start;
      await writeFile(
        path.join(output, `${sample}-response.json`),
        JSON.stringify({ ...raw, elapsedMs }, null, 2),
      );
      if (raw.choices[0]?.finish_reason !== 'stop')
        throw new Error('Incomplete response');
      const choice = schema.parse(JSON.parse(raw.choices[0].message.content));
      const validationErrors: string[] = [];
      const features = choice.selectedKeys.map((k) =>
        context.features.find((f) => f.key === k),
      );
      const encounters = choice.encounterKeys.map((k) =>
        context.encounters.find((e) => e.key === k),
      );
      if (
        features.some((f) => !f) ||
        new Set(choice.selectedKeys).size !== features.length
      )
        validationErrors.push('Unknown or duplicate feature');
      if (
        encounters.length !== features.length ||
        encounters.some((e, i) => !e || e.feature !== features[i]?.key)
      )
        validationErrors.push('Encounter does not match selected feature');
      if (
        features.length > 4 ||
        (choice.format === 'abstain') !== (features.length === 0)
      )
        validationErrors.push('Invalid selection size');
      if (
        choice.format === 'point_to_point' &&
        (features.length !== 2 || features.some((f) => f?.type !== 'place'))
      )
        validationErrors.push('Point-to-point requires two places');
      if (
        choice.format === 'loop' &&
        (features.length !== 1 || features[0]?.type !== 'place')
      )
        validationErrors.push('Loop requires one place');
      const ordered = features.map((f, i) => ({
        feature: f,
        encounter: encounters[i],
      }));
      if (choice.format === 'destinations')
        ordered.sort(
          (a, b) =>
            (a.encounter?.routePercent ?? 0) - (b.encounter?.routePercent ?? 0),
        );
      const title =
        validationErrors.length || !features.length
          ? null
          : choice.format === 'loop'
            ? `${features[0]!.name} loop`
            : ordered.map((o) => o.feature!.name).join(' – ');
      const result = {
        sample,
        activityId: base.results[index]!.activity.id,
        model: raw.model,
        requestedModel: model,
        requestHash,
        contextHash: createHash('sha256')
          .update(JSON.stringify(context))
          .digest('hex'),
        formatEncoding: format,
        runName: label,
        maxTokens,
        candidateCount: context.features.length,
        encounterCount: context.encounters.length,
        inputCharacters: input.length,
        elapsedMs,
        usage: raw.usage,
        generationId: raw.id,
        providerMetadata: raw.provider_metadata,
        ...choice,
        validationErrors,
        title,
        selectedEvidence: ordered,
        rawNames: features.map((f) => f?.name ?? '[unknown]'),
      };
      await writeFile(resultFile, JSON.stringify(result, null, 2));
      results.push(result);
      console.log(
        JSON.stringify({
          sample,
          title,
          errors: validationErrors,
          usage: raw.usage,
          elapsedMs,
        }),
      );
    } catch (error) {
      const failure = { sample, error: (error as Error).message };
      results.push(failure);
      console.log(JSON.stringify(failure));
    }
  }
}
await Promise.all([worker(), worker()]);
await writeFile(
  path.join(output, 'summary.json'),
  JSON.stringify(
    { model, format, generatedAt: new Date().toISOString(), results },
    null,
    2,
  ),
);
