/** Optional, explicit live comparison. Sends reduced OSM context only; inspect model-context.json first. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

import type { MatchResult } from './matching';
import { buildContexts, validateSelection } from './model-context';
import { originalPrompt, revisedPrompt, selectionPrompt } from './prompts';

dotenv.config({ quiet: true });
const directory = path.resolve(
  process.argv[2] ?? 'output/activity-name-prototype',
);
const model = process.argv[3];
const live = process.argv.includes('--live');
const replay = process.argv.includes('--replay');
if (live && replay) throw new Error('Choose live or replay, not both');
const input = JSON.parse(
  await readFile(path.join(directory, 'results.json'), 'utf8'),
) as {
  results: (MatchResult & {
    activity: { id: string; category: string };
    error?: string;
  })[];
};
const successful = input.results.filter((r) => !r.error);
const contexts = buildContexts(successful);
const promptVersion = process.argv.includes('--prompt=v1')
  ? 'v1'
  : process.argv.includes('--prompt=v2')
    ? 'v2'
    : 'v3';
const runName = process.argv.find((arg) => arg.startsWith('--run='))?.slice(6);
if (runName && !/^[a-z0-9-]+$/.test(runName))
  throw new Error('Invalid run label');
const output = runName ? path.join(directory, 'runs', runName) : directory;
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, 'model-context.json'),
  JSON.stringify(contexts, null, 2),
);
if (!live && !replay) {
  console.log(
    'Wrote model-context.json. No model request made. Supply a verified model ID and --live to compare.',
  );
} else {
  if (!model || model.startsWith('--'))
    throw new Error(
      'Pass an exact live catalog model ID as the second argument.',
    );
  const key =
    process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_AI_GATEWAY_KEY;
  if (!key && !replay) throw new Error('No configured AI Gateway key');
  const catalog = (
    replay
      ? JSON.parse(await readFile(path.join(directory, 'models.json'), 'utf8'))
      : await fetch('https://ai-gateway.vercel.sh/v1/models', {
          signal: AbortSignal.timeout(20000),
        }).then((r) => r.json())
  ) as {
    data: {
      id: string;
      pricing?: { input: string; output: string };
      tags?: string[];
    }[];
  };
  const metadata = catalog.data.find((m) => m.id === model);
  if (!metadata?.tags?.includes('structured-output'))
    throw new Error(
      'Model must appear in live catalog and support structured output',
    );
  const schema = z.object({
    suggestions: z.array(
      z.object({
        sample: z.string(),
        selectedKeys: z.array(z.string()),
        format: z
          .enum(['destinations', 'point_to_point', 'loop', 'abstain'])
          .optional(),
        explanation: z.string(),
      }),
    ),
  });
  const prompt =
    promptVersion === 'v1'
      ? originalPrompt
      : promptVersion === 'v2'
        ? revisedPrompt
        : selectionPrompt;
  const body = {
    model,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(contexts) },
    ],
    temperature: 0,
    max_tokens: 6000,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'activity_names',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sample: { type: 'string' },
                  selectedKeys: { type: 'array', items: { type: 'string' } },
                  ...(promptVersion === 'v3'
                    ? {}
                    : {
                        format: {
                          type: 'string',
                          enum: [
                            'destinations',
                            'point_to_point',
                            'loop',
                            'abstain',
                          ],
                        },
                      }),
                  explanation: { type: 'string' },
                },
                required:
                  promptVersion === 'v3'
                    ? ['sample', 'selectedKeys', 'explanation']
                    : ['sample', 'selectedKeys', 'format', 'explanation'],
                additionalProperties: false,
              },
            },
          },
          required: ['suggestions'],
          additionalProperties: false,
        },
      },
    },
  };
  type Response = {
    id: string;
    model: string;
    choices: { message: { content: string }; finish_reason: string }[];
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    provider_metadata?: unknown;
  };
  let raw: Response;
  let elapsedMs: number | null = null;
  if (replay) {
    const savedRequest = JSON.parse(
      await readFile(path.join(output, 'model-request.json'), 'utf8'),
    ) as typeof body;
    if (JSON.stringify(savedRequest) !== JSON.stringify(body))
      throw new Error(
        'Replay request/context changed; use the original inputs',
      );
    raw = JSON.parse(
      await readFile(path.join(output, 'model-response.json'), 'utf8'),
    ) as Response;
    try {
      elapsedMs = (
        JSON.parse(
          await readFile(path.join(output, 'model-timing.json'), 'utf8'),
        ) as { elapsedMs: number }
      ).elapsedMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  } else {
    await writeFile(
      path.join(output, 'model-request.json'),
      JSON.stringify(body, null, 2),
    );
    const start = Date.now();
    const response = await fetch(
      'https://ai-gateway.vercel.sh/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!response.ok) {
      const errorBody = await response.text();
      await writeFile(
        path.join(output, 'model-error.json'),
        JSON.stringify(
          {
            model,
            status: response.status,
            body: errorBody.replaceAll(key!, '[redacted]'),
          },
          null,
          2,
        ),
      );
      throw new Error(
        `AI Gateway returned HTTP ${response.status}; details saved locally in model-error.json`,
      );
    }
    raw = (await response.json()) as Response;
    elapsedMs = Date.now() - start;
    await writeFile(
      path.join(output, 'model-response.json'),
      JSON.stringify(raw, null, 2),
    );
    await writeFile(
      path.join(output, 'model-timing.json'),
      JSON.stringify({ elapsedMs }),
    );
  }
  if (raw.choices[0]?.finish_reason !== 'stop')
    throw new Error('Model response was incomplete');
  const result = schema.parse(JSON.parse(raw.choices[0].message.content));
  if (
    result.suggestions.length !== contexts.length ||
    new Set(result.suggestions.map((s) => s.sample)).size !== contexts.length
  )
    throw new Error('Incomplete or duplicate model suggestions');
  const suggestions = result.suggestions.map((s) => {
    const index = contexts.findIndex((c) => c.sample === s.sample);
    if (index < 0) throw new Error('Unknown sample');
    const context = contexts[index]!;
    const chosen = s.selectedKeys.map((key) =>
      context.features.find((c) => c.key === key),
    );
    const format =
      promptVersion === 'v3'
        ? !chosen.length
          ? 'abstain'
          : chosen.every((f) => f && ['start', 'end'].includes(f.role))
            ? context.loop
              ? 'loop'
              : 'point_to_point'
            : 'destinations'
        : s.format;
    if (!format) throw new Error('Missing format');
    const orderedKeys =
      promptVersion === 'v3'
        ? [...s.selectedKeys].sort(
            (a, b) =>
              context.features.findIndex((f) => f.key === a) -
              context.features.findIndex((f) => f.key === b),
          )
        : s.selectedKeys;
    const validationErrors = validateSelection(context, {
      selectedKeys: orderedKeys,
      format,
    });
    const names = chosen.map((c) => c?.displayName ?? '[unknown feature]');
    const orderedNames = orderedKeys.map(
      (key) =>
        context.features.find((f) => f.key === key)?.displayName ??
        '[unknown feature]',
    );
    const title =
      format === 'abstain' || validationErrors.length
        ? null
        : format === 'loop'
          ? `${orderedNames[0]} loop`
          : orderedNames.join(' – ');
    return {
      activityId: successful[index]!.activity.id,
      title,
      rawTitle:
        format === 'abstain'
          ? null
          : format === 'loop'
            ? `${names[0]} loop`
            : names.join(' – '),
      validationErrors,
      ...s,
      format,
      formatting: promptVersion === 'v3' ? 'local' : 'model',
    };
  });
  const estimateUsd =
    raw.usage.prompt_tokens * Number(metadata.pricing?.input ?? 0) +
    raw.usage.completion_tokens * Number(metadata.pricing?.output ?? 0);
  await writeFile(
    path.join(output, 'model-results.json'),
    JSON.stringify(
      {
        requestedModel: model,
        promptVersion,
        promptHash: createHash('sha256').update(prompt).digest('hex'),
        runName,
        returnedModel: raw.model,
        generationId: raw.id,
        elapsedMs,
        contextHash: createHash('sha256')
          .update(JSON.stringify(contexts))
          .digest('hex'),
        usage: raw.usage,
        catalogEstimateUsd: estimateUsd,
        providerMetadata: raw.provider_metadata,
        suggestions,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        model: raw.model,
        usage: raw.usage,
        estimateUsd,
        suggestions: suggestions.map((s) => ({
          sample: s.sample,
          title: s.title,
        })),
      },
      null,
      2,
    ),
  );
}
