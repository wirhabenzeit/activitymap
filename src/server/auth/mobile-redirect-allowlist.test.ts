import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidRedirectAllowlistEntryError,
  isAllowedMobileRedirectUri,
  parseMobileRedirectAllowlist,
} from './mobile-redirect-allowlist.ts';

const ALLOWLIST = parseMobileRedirectAllowlist(
  'https://app.activitymap.example/auth/callback,activitymap://auth/callback',
);

void test('parseMobileRedirectAllowlist returns an empty list for undefined/blank env', () => {
  assert.deepEqual(parseMobileRedirectAllowlist(undefined), []);
  assert.deepEqual(parseMobileRedirectAllowlist('  '), []);
});

void test('parseMobileRedirectAllowlist rejects a malformed entry', () => {
  assert.throws(
    () => parseMobileRedirectAllowlist('not-a-url'),
    InvalidRedirectAllowlistEntryError,
  );
});

void test('accepts an exact allow-listed https redirect', () => {
  assert.equal(
    isAllowedMobileRedirectUri(
      'https://app.activitymap.example/auth/callback',
      ALLOWLIST,
    ),
    true,
  );
});

void test('accepts a sub-path of an allow-listed https redirect', () => {
  assert.equal(
    isAllowedMobileRedirectUri(
      'https://app.activitymap.example/auth/callback/device-1',
      ALLOWLIST,
    ),
    true,
  );
});

void test('accepts an allow-listed custom-scheme universal link', () => {
  assert.equal(
    isAllowedMobileRedirectUri('activitymap://auth/callback', ALLOWLIST),
    true,
  );
});

void test('rejects a host that is not on the allow-list', () => {
  assert.equal(
    isAllowedMobileRedirectUri(
      'https://evil.example/auth/callback',
      ALLOWLIST,
    ),
    false,
  );
});

void test('rejects a suffix lookalike host (open-redirect bypass attempt)', () => {
  assert.equal(
    isAllowedMobileRedirectUri(
      'https://app.activitymap.example.evil.test/auth/callback',
      ALLOWLIST,
    ),
    false,
  );
});

void test('rejects a path-prefix lookalike (segment-boundary bypass attempt)', () => {
  assert.equal(
    isAllowedMobileRedirectUri(
      'https://app.activitymap.example/auth/callback-evil',
      ALLOWLIST,
    ),
    false,
  );
});

void test('rejects an embedded-URL bypass attempt', () => {
  assert.equal(
    isAllowedMobileRedirectUri(
      'https://evil.example/?next=https://app.activitymap.example/auth/callback',
      ALLOWLIST,
    ),
    false,
  );
});

void test('rejects a scheme mismatch against an otherwise-matching host', () => {
  assert.equal(
    isAllowedMobileRedirectUri(
      'http://app.activitymap.example/auth/callback',
      ALLOWLIST,
    ),
    false,
  );
});

void test('rejects every candidate when the allow-list is empty (fail closed)', () => {
  assert.equal(
    isAllowedMobileRedirectUri('https://app.activitymap.example/auth/callback', []),
    false,
  );
});

void test('rejects an unparseable candidate URI', () => {
  assert.equal(isAllowedMobileRedirectUri('not-a-url', ALLOWLIST), false);
});
