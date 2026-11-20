import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import test from 'node:test';

import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_PATHS,
  MARKETING_PATH,
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

void test('the marketing page exists and every screenshot it references is shipped', () => {
  const page = readFileSync(
    new URL('../app/about/page.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(MARKETING_PATH, '/about');

  const shots = [...page.matchAll(/name: '([^']+)',\s*dark: (true|false)/g)];
  assert.ok(shots.length >= 3, 'the page lists its screenshots');
  const publicFile = (name: string) =>
    new URL(`../../public/about/${name}`, import.meta.url);
  for (const [, name, dark] of shots) {
    assert.ok(existsSync(publicFile(`${name}-light.webp`)), `${name}-light`);
    if (dark === 'true') {
      assert.ok(existsSync(publicFile(`${name}-dark.webp`)), `${name}-dark`);
    }
  }
  assert.ok(existsSync(publicFile('og.jpg')), 'the social preview image');
});

void test('the marketing page keeps Strava to plain facts', () => {
  const page = readFileSync(
    new URL('../app/about/page.tsx', import.meta.url),
    'utf8',
  );
  // Strava's brand rules: never in the app name, and no claim of endorsement.
  assert.doesNotMatch(page, /Strava ?Map/i);
  assert.match(page, /not made, endorsed or sponsored by Strava/);
  assert.match(page, /PoweredByStrava/);
});
