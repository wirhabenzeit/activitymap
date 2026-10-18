/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions & import('@trivago/prettier-plugin-sort-imports').PrettierConfig} */
const config = {
  tabWidth: 2,
  useTabs: false,
  printWidth: 80,
  trailingComma: 'all',
  singleQuote: true,
  semi: true,
  importOrder: [
    '<BUILTIN_MODULES>',
    '<THIRD_PARTY_MODULES>',
    '^~/(.*)$',
    '^[./]',
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  // Keep CSS/polyfill/server-only imports in their original evaluation order.
  importOrderSideEffects: false,
  plugins: [
    '@trivago/prettier-plugin-sort-imports',
    'prettier-plugin-tailwindcss',
  ],
  tailwindStylesheet: './src/styles/globals.css',
};

export default config;
