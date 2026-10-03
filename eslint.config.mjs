import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import prettier from 'eslint-config-prettier';

const unused = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'resources/**',
      'coverage/**',
      'artifacts/**',
      'fixtures/**',
      'playwright-report/**',
      'test-results/**',
      'src/legacy/**',
      'scripts/sign.js',
    ],
  },
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': unused,
      '@typescript-eslint/no-explicit-any': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/valid-v-slot': ['error', { allowModifiers: true }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Architecture: core is pure. Machine access goes through ports.
    files: ['src/core/**/*.ts', 'src/features/*/core/**/*.ts', 'src/features/games/*/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'electron',
            'fs',
            'node:fs',
            'fs/promises',
            'node:fs/promises',
            'child_process',
            'node:child_process',
            'koffi',
          ].map((name) => ({ name, message: 'core code must go through ports (src/core/ports)' })),
        },
      ],
    },
  },
  {
    // Architecture: features never reach into another feature's internals.
    files: ['src/features/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/legacy/**'],
              message: 'src/legacy is reference material; copy what you need into your feature',
            },
            {
              group: ['**/main/**', '**/platform/**'],
              message: 'features use ports from src/core, not main or platform',
            },
          ],
        },
      ],
    },
  },
  prettier
);
