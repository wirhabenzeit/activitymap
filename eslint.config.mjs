import typescriptEslint from '@typescript-eslint/eslint-plugin';
import drizzle from 'eslint-plugin-drizzle';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  ...compat.extends(
    'next/core-web-vitals',
    'prettier',
    'plugin:drizzle/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:@typescript-eslint/stylistic-type-checked',
    'plugin:@typescript-eslint/strict',
  ),
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
      drizzle,
    },
    rules: {
      ...drizzle.configs.recommended.rules,
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 5,
      //sourceType: 'script',

      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },

  //

  //     rules: {
  //         "@typescript-eslint/array-type": "off",
  //         "@typescript-eslint/consistent-type-definitions": "off",

  //         "@typescript-eslint/consistent-type-imports": ["warn", {
  //             prefer: "type-imports",
  //             fixStyle: "inline-type-imports",
  //         }],

  //         "@typescript-eslint/no-unused-vars": ["warn", {
  //             argsIgnorePattern: "^_",
  //         }],

  //         "@typescript-eslint/require-await": "off",

  //         "@typescript-eslint/no-misused-promises": ["error", {
  //             checksVoidReturn: {
  //                 attributes: false,
  //             },
  //         }],

  //         "drizzle/enforce-delete-with-where": ["error", {
  //             drizzleObjectName: ["db"],
  //         }],

  //         "drizzle/enforce-update-with-where": ["error", {
  //             drizzleObjectName: ["db"],
  //         }],
  //     },
  // }
];
