'use node';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { v } from 'convex/values';

import {
  decodeWhole,
  encodeWhole,
  sha256,
  validateRecording,
} from '../recording/codec';
import { FIXTURE_SAMPLES, generateFixture } from '../recording/fixtures';
import { fixtureMatch, recordingSummary } from '../recording/processing';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { uploadContentType } from './recording/validators';

export const run = internalAction({
  args: {
    fixture: v.union(
      v.literal('small'),
      v.literal('typical'),
      v.literal('oversized'),
      v.literal('largest'),
    ),
    guards: v.optional(v.boolean()),
  },
  handler: async (ctx, { fixture, guards }): Promise<unknown> => {
    const scope = {
      owner: 'recording-lab-synthetic',
      key: randomUUID(),
      accountGeneration: randomUUID(),
      sourceVersion: 'synthetic-v1',
      generation: randomUUID(),
    };
    const streams = validateRecording(
      generateFixture(FIXTURE_SAMPLES[fixture]),
    );
    const encodeStarted = performance.now();
    const { file, manifest } = encodeWhole(streams);
    const summary = recordingSummary(streams);
    const encodeMs = performance.now() - encodeStarted;
    const upload = async (attempt: Id<'recordingAttempts'>) => {
      const bytes = Uint8Array.from(file);
      return ctx.storage.store(
        new Blob([bytes], { type: uploadContentType(attempt) }),
      );
    };
    // The hosted _storage metadata uses base64; the raw content hash is hex.
    const compressedHash = sha256(file, 'base64');
    const provisioned = await ctx.runMutation(
      internal.recordingRows.provision,
      scope,
    );
    assert(provisioned);
    try {
      const begin = (): Promise<Id<'recordingAttempts'>> =>
        ctx.runMutation(internal.recordingRows.begin, {
          scope,
          manifest,
          compressedHash,
        });
      const attempt = await begin();
      const uploadStarted = performance.now();
      const fileId = await upload(attempt);
      const uploadMs = performance.now() - uploadStarted;
      const publishStarted = performance.now();
      assert.equal(
        await ctx.runMutation(internal.recordingRows.publish, {
          attempt,
          file: fileId,
          summary,
        }),
        1,
      );
      const publishMs = performance.now() - publishStarted;
      const queryStarted = performance.now();
      const current = await ctx.runQuery(internal.recordingRows.current, scope);
      const queryMs = performance.now() - queryStarted;
      assert(current);
      assert.deepEqual(current.summary, summary);
      assert.deepEqual(current.manifest.manifest, manifest);
      assert.equal(current.manifest.revision, 1);
      assert.equal(current.manifest.accountGeneration, scope.accountGeneration);
      assert.equal(current.manifest.sourceVersion, scope.sourceVersion);
      assert.equal(current.manifest.generation, scope.generation);
      const downloadStarted = performance.now();
      const blob = await ctx.storage.get(current.manifest.file);
      assert(blob);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const downloadMs = performance.now() - downloadStarted;
      const decodeStarted = performance.now();
      const restored = decodeWhole(bytes, manifest);
      const decodeMs = performance.now() - decodeStarted;
      assert.deepEqual(restored, streams);

      let matcherMatches: number | undefined;
      if (fixture === 'small') {
        const result = fixtureMatch(restored);
        assert.deepEqual(result, fixtureMatch(streams));
        assert(result.matches.length > 0);
        matcherMatches = result.matches.length;
      }
      if (guards) {
        await assert.rejects(
          ctx.runQuery(internal.recordingRows.current, {
            ...scope,
            accountGeneration: randomUUID(),
          }),
        );
        assert.equal(
          await ctx.runQuery(internal.recordingRows.current, {
            ...scope,
            owner: 'other-synthetic-owner',
          }),
          null,
        );
        const stale = await begin();
        const orphan = await upload(stale);
        const newer = await begin();
        // A published file cannot be registered under an unrelated attempt.
        await assert.rejects(
          ctx.runMutation(internal.recordingRows.publish, {
            attempt: newer,
            file: fileId,
            summary,
          }),
        );
        assert.equal(
          await ctx.runMutation(internal.recordingRows.publish, {
            attempt: stale,
            file: orphan,
            summary,
          }),
          null,
        );
        // Exercise the post-upload crash gap: neither close nor reap receives
        // the file ID, so recovery must discover it from registered metadata.
        await ctx.runMutation(internal.recordingRows.close, { attempt: stale });
        assert.equal(
          await ctx.runMutation(internal.recordingRows.reap, {
            attempt: stale,
            cursor: null,
          }),
          1,
        );
        assert.equal(await ctx.storage.get(orphan), null);
        assert(await ctx.storage.get(fileId));
        const replacement = await upload(newer);
        assert.equal(
          await ctx.runMutation(internal.recordingRows.publish, {
            attempt: newer,
            file: replacement,
            summary,
          }),
          2,
        );
        assert.equal(await ctx.storage.get(fileId), null);
        const erased = await begin();
        assert.equal(
          await ctx.runMutation(internal.recordingRows.erase, scope),
          true,
        );
        assert.equal(await ctx.storage.get(replacement), null);
        await ctx.runMutation(internal.recordingRows.provision, scope);
        assert.equal(
          await ctx.runMutation(internal.recordingRows.publish, {
            attempt: erased,
            file: replacement,
            summary,
          }),
          null,
        );
        assert.equal(
          await ctx.runQuery(internal.recordingRows.current, scope),
          null,
        );
        await ctx.runMutation(internal.recordingRows.close, {
          attempt: erased,
        });
        assert.equal(
          await ctx.runMutation(internal.recordingRows.reap, {
            attempt: erased,
            cursor: null,
          }),
          0,
        );
      }
      const { contentHash: _, ...sizes } = manifest;
      return {
        fixture,
        ...sizes,
        encodeMs,
        uploadMs,
        publishMs,
        queryMs,
        downloadMs,
        decodeMs,
        summaryBytes: Buffer.byteLength(JSON.stringify(summary)),
        processMaxRssKiB: process.resourceUsage().maxRSS,
        node: process.version,
        ...(matcherMatches === undefined ? {} : { matcherMatches }),
        guards: guards === true,
      };
    } finally {
      await ctx.runMutation(internal.recordingRows.erase, scope);
    }
  },
});
