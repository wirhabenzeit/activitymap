'use node';

import { setTimeout as sleep } from 'node:timers/promises';

import { encodeWhole, sha256, validateRecording } from '../recording/codec';
import { recordingSummary } from '../recording/processing';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { fixtureProvider } from './ingestion/provider';
import { claim } from './ingestion/validators';
import { uploadContentType } from './recording/validators';

function crash(at: string, fault?: string) {
  if (fault === at) throw new Error(`Injected ${at}`);
}

export const run = internalAction({
  args: claim,
  handler: async (ctx, token): Promise<void> => {
    let detail = await ctx.runMutation(internal.ingestionJobs.nextRequest, {
      ...token,
      previous: 'fetch',
    });
    if (!detail) return;
    if (detail.kind === 'refresh') {
      crash('before-refresh', detail.fault);
      const refresh = await fixtureProvider.refresh(detail.credential);
      if (detail.fault === 'overlap-refresh')
        await sleep(detail.leaseMs + 2_000);
      crash('after-refresh', detail.fault);
      if (
        !(await ctx.runMutation(internal.ingestionJobs.refreshed, {
          ...token,
          previous: refresh.previous,
          next: refresh.next,
        }))
      )
        return;
      detail = await ctx.runMutation(internal.ingestionJobs.nextRequest, {
        ...token,
        previous: 'fetch',
      });
    }
    if (!detail || detail.kind !== 'detail') return;
    crash('before-detail', detail.fault);
    const { name } = await fixtureProvider.detail(detail);
    crash('after-detail', detail.fault);

    const streams = await ctx.runMutation(internal.ingestionJobs.nextRequest, {
      ...token,
      previous: 'detail',
    });
    if (!streams || streams.kind !== 'streams') return;
    crash('before-streams', streams.fault);
    const { fault, credential, startedAt } = streams;
    const response = await fixtureProvider.streams(streams);
    if (response.status !== 200) {
      await ctx.runMutation(internal.ingestionJobs.failed, {
        ...token,
        credential,
        startedAt,
        request: 'streams',
        status: response.status,
        retryAfterMs: response.retryAfterMs,
      });
      return;
    }
    const payload = validateRecording(response.payload);
    crash('after-streams', fault);

    const { file, manifest } = encodeWhole(payload);
    const summary = recordingSummary(payload);
    const upload = await ctx.runMutation(
      internal.ingestionJobs.registerUpload,
      {
        ...token,
        credential,
        manifest,
        compressedHash: sha256(file, 'base64'),
      },
    );
    if (!upload) return;
    crash('before-upload', fault);
    const fileId = await ctx.storage.store(
      new Blob([Uint8Array.from(file)], { type: uploadContentType(upload) }),
    );
    crash('after-upload', fault);
    if (fault === 'overlap' || fault === 'hold-upload') {
      await sleep(fault === 'overlap' ? streams.leaseMs + 2_000 : 2_500);
    }
    const accepted = await ctx.runMutation(internal.ingestionJobs.commit, {
      ...token,
      credential,
      upload,
      file: fileId,
      summary,
      name,
    });
    if (!accepted)
      await ctx.runMutation(internal.ingestionJobs.abandonUpload, { upload });
    crash('after-commit', fault);
  },
});
