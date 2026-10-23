/** Draft Vercel AI Gateway adapter; explicit credentials and injectable fetch. */
import { z } from 'zod';

import { assemble } from '../filtered-context';
import type { PreparedInference } from './jev';

export const JEV_MODEL = 'typesafe-ai/jev';
export const GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate';
const probability = z.number().min(0).max(1);
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal('choice'),
      choice: z.string(),
      probabilities: z.record(z.string(), probability),
      confidence: probability.optional(),
    }),
  ),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  }),
  providerMetadata: z
    .object({
      gateway: z
        .object({
          cost: z.string().optional(),
          generationId: z.string().optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

export function gatewayRequest(prepared: PreparedInference) {
  return { model: JEV_MODEL, ...prepared.input };
}

export async function inferTitle(
  prepared: PreparedInference,
  options: { apiKey: string; fetch?: typeof fetch; signal?: AbortSignal },
) {
  if (!options.apiKey.trim()) throw new Error('No AI Gateway key configured');
  const started = Date.now();
  const response = await (options.fetch ?? fetch)(GATEWAY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(gatewayRequest(prepared)),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  // Never include upstream response text: it may contain request data or secrets.
  if (!response.ok) throw new Error(`AI Gateway HTTP ${response.status}`);
  const parsed = responseSchema.parse(await response.json());
  const result = assemble(
    prepared.context,
    prepared.input.questions,
    parsed.answers,
  );
  const reportedCost =
    parsed.usage.cost ?? Number(parsed.providerMetadata?.gateway?.cost ?? NaN);
  return {
    ...result,
    diagnostics: {
      model: parsed.model,
      policyVersion: prepared.version,
      answers: parsed.answers,
      inputTokens: parsed.usage.inputTokens,
      elapsedMs: Date.now() - started,
      cost: Number.isFinite(reportedCost) ? reportedCost : null,
      generationId: parsed.providerMetadata?.gateway?.generationId ?? null,
    },
  };
}
