import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

import { generatedFiles, validateCatalog } from './generate-presentation.mjs';

const catalog = JSON.parse(
  readFileSync(
    new URL('../shared/presentation/catalog.v1.json', import.meta.url),
    'utf8',
  ),
);
const mutate = (change) => {
  const copy = structuredClone(catalog);
  change(copy);
  return copy;
};

test('sport membership is unique, exhaustive and protocol-stable on both clients', () => {
  assert.equal(validateCatalog(catalog).size, 50);
  const source = readFileSync(
    new URL('../src/server/strava/types.ts', import.meta.url),
    'utf8',
  );
  const sports = source
    .split('] as const;')[0]
    .match(/'([^']+)'/g)
    .map((value) => value.slice(1, -1))
    .filter((value) => !value.startsWith('~/'));
  assert.deepEqual([...validateCatalog(catalog)].sort(), sports.sort());
  assert(generatedFiles(catalog).size >= 3);
});
test('invalid semantic references, mappings and membership fail loudly', () => {
  assert.throws(
    () => validateCatalog(mutate((c) => (c.actions.back.message = 'unknown'))),
    /Unknown message/,
  );
  assert.throws(
    () => validateCatalog(mutate((c) => delete c.metrics.distance.iosGlyph)),
    /Missing platform mapping/,
  );
  assert.throws(
    () =>
      validateCatalog(
        mutate((c) => c.categories[1].sports.push(c.categories[0].sports[0])),
      ),
    /Duplicate sport/,
  );
  assert.throws(
    () => validateCatalog(mutate((c) => delete c.messages['action.back'])),
    /Unknown message|Missing message|Cannot/,
  );
});
test('native standalone metrics cannot silently fall back after removing a semantic ID', () => {
  assert.throws(
    () => generatedFiles(mutate((c) => delete c.metrics.max_speed)),
    /Native standalone metric coverage/,
  );
});

test('named arguments and complete plural forms agree before generation', () => {
  assert.throws(
    () =>
      validateCatalog(
        mutate(
          (c) => (c.messages['selection.count'].source = '{total} activities'),
        ),
      ),
    /Placeholder mismatch/,
  );
  assert.throws(
    () =>
      validateCatalog(
        mutate((c) => delete c.messages['selection.count'].plural.one),
      ),
    /Missing plural/,
  );
  assert.throws(
    () =>
      validateCatalog(
        mutate(
          (c) => (c.messages['selection.count'].plural.other = 'Activities'),
        ),
      ),
    /Plural placeholder/,
  );
  assert.throws(
    () =>
      validateCatalog(
        mutate(
          (c) => (c.messages['selection.count'].arguments.count = 'string'),
        ),
      ),
    /Invalid plural argument/,
  );
});
test('native generated resources preserve translator-maintained localizations', () => {
  const translated = {
    strings: {
      'connect.title': {
        localizations: {
          de: {
            stringUnit: { state: 'translated', value: 'Mit Strava verbinden' },
          },
        },
      },
    },
  };
  const strings = JSON.parse(
    generatedFiles(catalog, translated).get(
      'ios/ActivityMap/ActivityMap/Resources/Presentation.xcstrings',
    ),
  ).strings;
  assert.equal(
    strings['selection.count'].localizations.en.variations.plural.one.stringUnit
      .value,
    '%lld activity',
  );
  assert.equal(
    strings['connect.verify.message'].localizations.en.stringUnit.value,
    'Your sign-in was saved. %@',
  );
  assert.equal(strings['connect.title'].extractionState, 'manual');
  assert.equal(
    strings['connect.title'].localizations.de.stringUnit.value,
    'Mit Strava verbinden',
  );
  translated.strings['connect.title'].localizations.de.stringUnit.value =
    'Bad %@';
  assert.throws(
    () => generatedFiles(catalog, translated),
    /Translation placeholder mismatch/,
  );
});
test('directional navigation and contextual export/activation retain distinct semantics', () => {
  assert.equal(catalog.actions.back.mirrorsInRTL, true);
  assert.equal(catalog.actions.close.mirrorsInRTL, false);
  assert.notEqual(
    catalog.actions.exportGPX.message,
    catalog.actions.exportGPX.iosMessage,
  );
  assert.notEqual(
    catalog.actions.select.message,
    catalog.actions.activate.message,
  );
  assert.notEqual(
    catalog.actions.showOnMap.message,
    catalog.actions.clearFiltersAndShowOnMap.message,
  );
});
