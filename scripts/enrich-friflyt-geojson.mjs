#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const rawArgs = process.argv.slice(2);
const positionalArgs = [];
let translateShortTitles = false;

for (const arg of rawArgs) {
  if (arg === '--translate') {
    translateShortTitles = true;
    continue;
  }
  positionalArgs.push(arg);
}

const inputGeoJsonPath = positionalArgs[0] ?? 'public/friflyt/friflyt_merged.geojson';
const mapDataPath = positionalArgs[1] ?? 'public/friflyt/mapdata.json';
const outputGeoJsonPath = positionalArgs[2] ?? 'public/friflyt/friflyt_enriched.geojson';
const translationCachePath =
  process.env.FRIFLYT_TRANSLATION_CACHE ?? 'public/friflyt/translation-cache.json';
const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const translationBatchSize = Number.parseInt(
  process.env.FRIFLYT_TRANSLATION_BATCH_SIZE ?? '100',
  10,
);

const normalizeKey = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const assetToKey = (assetUrl) => {
  const base = path.basename(String(assetUrl ?? ''), path.extname(String(assetUrl ?? '')));
  const withoutPrefix = base.replace(/^\d+[-_]?/, '');
  return normalizeKey(withoutPrefix);
};

const aliasBySourceKey = {
  sorvest: 'trygge_toppturer',
  torms: 'troms',
};

const getResponseText = (responseJson) => {
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  if (!Array.isArray(responseJson.output)) return '';

  const chunks = [];
  for (const item of responseJson.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }
  return chunks.join('\n').trim();
};

const parseJsonArrayFromText = (text) => {
  const trimmed = text.trim();
  const direct = (() => {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })();
  if (direct) return direct;

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const translateBatchToEnglish = async (apiKey, texts) => {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0,
      input: [
        {
          role: 'system',
          content:
            'Translate Norwegian ski-route teaser text to natural English. Keep place names unchanged. Return only a JSON array of translated strings in the same order as the input array.',
        },
        {
          role: 'user',
          content: JSON.stringify(texts),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const outputText = getResponseText(data);
  const translated = outputText ? parseJsonArrayFromText(outputText) : null;
  if (!translated) {
    throw new Error('OpenAI API returned empty translation output');
  }
  if (translated.length !== texts.length) {
    throw new Error(
      `OpenAI API returned ${translated.length} translations for ${texts.length} inputs`,
    );
  }
  return translated.map((value) => String(value ?? '').trim());
};

const geojson = JSON.parse(fs.readFileSync(inputGeoJsonPath, 'utf8'));
const mapdata = JSON.parse(fs.readFileSync(mapDataPath, 'utf8'));

if (!Array.isArray(geojson.features)) {
  throw new Error(`Invalid GeoJSON: no features array in ${inputGeoJsonPath}`);
}

if (!Array.isArray(mapdata.source)) {
  throw new Error(`Invalid mapdata: no source array in ${mapDataPath}`);
}

const metadataByKey = new Map();
for (const entry of mapdata.source) {
  if (!Array.isArray(entry.properties) || entry.properties.length === 0) {
    continue;
  }
  const keys = new Set();
  keys.add(normalizeKey(entry.title));
  keys.add(assetToKey(entry.asset));
  for (const key of keys) {
    if (!key) continue;
    if (!metadataByKey.has(key)) metadataByKey.set(key, []);
    metadataByKey.get(key).push(entry);
  }
}

const featuresBySource = new Map();
for (const feature of geojson.features) {
  const source = feature?.properties?.source;
  if (!source) continue;
  if (!featuresBySource.has(source)) featuresBySource.set(source, []);
  featuresBySource.get(source).push(feature);
}

const report = [];

for (const [sourceName, features] of featuresBySource.entries()) {
  const sourceKey = normalizeKey(sourceName);
  const mappedKey = aliasBySourceKey[sourceKey] ?? sourceKey;
  const candidates = metadataByKey.get(mappedKey) ?? [];
  const entry = candidates[0];

  if (!entry) {
    report.push({
      source: sourceName,
      features: features.length,
      metadataRows: 0,
      matched: 0,
      note: 'no metadata entry',
    });
    continue;
  }

  const rowsByFeatureId = new Map();
  for (const row of entry.properties) {
    const id = String(row?.featureId ?? '').trim();
    if (!id || rowsByFeatureId.has(id)) continue;
    rowsByFeatureId.set(id, row);
  }

  let matched = 0;
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const featureId = String(i + 1);
    const row = rowsByFeatureId.get(featureId);
    if (!row) continue;

    const link = row.link ?? {};
    const shortTitle = link.shortTitle ?? null;
    const fullTitle = link.title ?? null;
    const canonical = link.canonical ?? null;
    const preferredTitle = fullTitle || shortTitle || entry.title || sourceName;

    if (!feature.properties.title) {
      feature.properties.title = preferredTitle;
    }
    if (
      !feature.properties.description &&
      shortTitle &&
      fullTitle &&
      shortTitle !== fullTitle
    ) {
      feature.properties.description = shortTitle;
    }
    feature.properties.short_title = shortTitle;
    feature.properties.full_title = fullTitle;
    feature.properties.canonical = canonical;
    feature.properties.original_url = canonical;
    feature.properties.meta_feature_id = featureId;
    feature.properties.meta_collection = entry.title ?? sourceName;
    matched++;
  }

  report.push({
    source: sourceName,
    features: features.length,
    metadataRows: rowsByFeatureId.size,
    matched,
    note: entry.title,
  });
}

if (translateShortTitles) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required when using --translate');
  }

  const cache = fs.existsSync(translationCachePath)
    ? JSON.parse(fs.readFileSync(translationCachePath, 'utf8'))
    : {};

  const shortTitles = new Set();
  for (const feature of geojson.features) {
    const value = feature?.properties?.short_title;
    if (typeof value === 'string' && value.trim()) {
      shortTitles.add(value.trim());
    }
  }

  const pending = [...shortTitles].filter((text) => !cache[text]);
  console.log(
    `Translating short_title values: ${shortTitles.size} unique, ${pending.length} pending`,
  );

  const batchSize =
    Number.isFinite(translationBatchSize) && translationBatchSize > 0
      ? translationBatchSize
      : 100;
  let translatedNow = 0;
  let aborted = false;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    try {
      const translatedBatch = await translateBatchToEnglish(openaiApiKey, batch);
      for (let j = 0; j < batch.length; j++) {
        cache[batch[j]] = translatedBatch[j];
      }
      translatedNow += batch.length;
      console.log(`Translated ${Math.min(i + batch.length, pending.length)}/${pending.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('insufficient_quota')) {
        console.warn(
          'OpenAI quota exceeded; stopping translation early and using cached values only.',
        );
        aborted = true;
        break;
      }
      console.warn(
        `OpenAI translation request failed (${message}); stopping translation early and using cached values only.`,
      );
      aborted = true;
      break;
    }
  }

  let translatedFeatures = 0;
  for (const feature of geojson.features) {
    const shortTitle = feature?.properties?.short_title;
    if (typeof shortTitle === 'string' && shortTitle.trim()) {
      const translated = cache[shortTitle.trim()] ?? null;
      feature.properties.short_title_en = translated;
      if (translated) translatedFeatures++;
    }
  }

  fs.writeFileSync(translationCachePath, JSON.stringify(cache, null, 2));
  console.log(`Updated translation cache: ${translationCachePath}`);
  console.log(
    `Translation summary: added ${translatedNow} new entries, mapped ${translatedFeatures} features${aborted ? ' (aborted due to quota)' : ''
    }`,
  );
}

fs.writeFileSync(outputGeoJsonPath, JSON.stringify(geojson));

console.log(`Wrote ${outputGeoJsonPath}`);
console.table(report);
