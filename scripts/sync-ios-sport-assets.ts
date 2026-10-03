/** Run with `pnpm exec tsx scripts/sync-ios-sport-assets.ts` after changing web sport identity. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { categorySettings } from '../src/settings/category';

const assets = fileURLToPath(new URL('../ios/ActivityMap/ActivityMap/Assets.xcassets/', import.meta.url));
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
for (const [category, { icon, color }] of Object.entries(categorySettings)) {
  const imageDir = `${assets}Sport-${category}.imageset`;
  const colorDir = `${assets}Sport-${category}.colorset`;
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(colorDir, { recursive: true });
  const svg = renderToStaticMarkup(createElement(icon)).replaceAll('currentColor', '#000000').replace(/width="1em"/, 'width="32"').replace(/height="1em"/, 'height="32"');
  writeFileSync(`${imageDir}/sport.svg`, svg + '\n');
  json(`${imageDir}/Contents.json`, {
    images: [{ filename: 'sport.svg', idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
    properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
  });
  const [red, green, blue] = [1, 3, 5].map((offset) => `0x${color.slice(offset, offset + 2)}`);
  json(`${colorDir}/Contents.json`, {
    colors: [{ idiom: 'universal', color: { 'color-space': 'srgb', components: { red, green, blue, alpha: '1.000' } } }],
    info: { author: 'xcode', version: 1 },
  });
}
