import assert from 'node:assert/strict';
import test from 'node:test';

import { generateShareToken, hashShareToken, SHARE_TOKEN_BYTES } from './tokens.ts';

void test('generateShareToken produces high-entropy, unique, URL-safe tokens', () => {
  const tokens = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
  assert.equal(tokens.size, 1000, 'expected 1000 distinct tokens with no collisions');

  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]+$/, 'token must be base64url (URL-safe)');
  }

  // 32 random bytes base64url-encode to at least 43 characters (no padding).
  const sample = tokens.values().next().value;
  assert.ok(typeof sample === 'string' && sample.length >= 43, `expected a token derived from ${SHARE_TOKEN_BYTES} bytes to be long`);
});

void test('hashShareToken is deterministic and never returns the input', () => {
  const token = generateShareToken();
  const hash1 = hashShareToken(token);
  const hash2 = hashShareToken(token);

  assert.equal(hash1, hash2, 'hashing the same token twice must be deterministic');
  assert.notEqual(hash1, token, 'the hash must never equal the plaintext token');
  assert.ok(!hash1.includes(token), 'the hash must not embed the plaintext token');
});

void test('hashShareToken produces different hashes for different tokens', () => {
  const a = hashShareToken(generateShareToken());
  const b = hashShareToken(generateShareToken());
  assert.notEqual(a, b);
});

void test('a guessed/incremented token does not hash to a real token\'s hash', () => {
  const real = generateShareToken();
  const realHash = hashShareToken(real);

  // Simulate an attacker trying small, structured variations of a real
  // token (e.g. flipping the last character) - none of these should ever
  // collide with the real hash.
  const guesses = [
    real.slice(0, -1) + (real.endsWith('A') ? 'B' : 'A'),
    real + 'x',
    real.slice(0, -1),
    '0'.repeat(real.length),
  ];

  for (const guess of guesses) {
    assert.notEqual(hashShareToken(guess), realHash);
  }
});
