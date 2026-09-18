import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import drizzle from 'eslint-plugin-drizzle';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...nextVitals,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: {
      drizzle,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      ...drizzle.configs.recommended.rules,
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
  },
  {
    // Server/API code must log through src/server/logging so authorization
    // headers, session/token values, and personal activity data are
    // redacted before anything reaches the log output.
    files: ['src/server/**/*.{ts,tsx}', 'src/app/api/**/*.{ts,tsx}'],
    ignores: ['src/server/logging/**'],
    rules: {
      'no-console': 'error',
    },
  },
  prettier,
);
