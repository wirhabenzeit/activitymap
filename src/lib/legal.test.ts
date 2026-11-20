import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_PATHS,
  legalMailto,
} from './legal.ts';

void test('legal pages live at fixed, absolute paths', () => {
  assert.deepEqual(LEGAL_PATHS, {
    privacy: '/privacy',
    terms: '/terms',
    support: '/support',
  });
  assert.match(LEGAL_LAST_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
});

void test('the iOS app links to the same paths the web serves', () => {
  const swift = readFileSync(
    new URL(
      '../../ios/ActivityMap/ActivityMap/Support/LegalLinks.swift',
      import.meta.url,
    ),
    'utf8',
  );
  for (const [name, path] of Object.entries(LEGAL_PATHS)) {
    assert.match(
      swift,
      new RegExp(`static var ${name}: URL \\{[^}]*path: "${path.slice(1)}"`),
      `LegalLinks.${name} must point at ${path}`,
    );
  }
});

void test('every legal page exists as a route outside the authenticated shell', () => {
  for (const name of Object.keys(LEGAL_PATHS)) {
    const page = new URL(`../app/(legal)/${name}/page.tsx`, import.meta.url);
    assert.ok(readFileSync(page, 'utf8').includes('LegalPage'), name);
  }
});

void test('the contact link is a mailto for the published address', () => {
  assert.equal(legalMailto(), `mailto:${LEGAL_CONTACT_EMAIL}`);
  assert.equal(
    legalMailto('Privacy request'),
    `mailto:${LEGAL_CONTACT_EMAIL}?subject=Privacy%20request`,
  );
});
