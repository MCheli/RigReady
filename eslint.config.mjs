import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import prettier from 'eslint-config-prettier';

const unused = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }];

/** Modules that read or change the machine. Only src/platform may import them. */
const machineModules = [
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'child_process',
  'node:child_process',
  'koffi',
];
const viaPorts = (name) => ({
  name,
  message: 'only src/platform touches the machine; use the ports in src/core/ports',
});

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
    files: ['src/core/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...machineModules, 'electron'].map(viaPorts),
          patterns: [
            {
              group: ['**/platform/**', '**/main/**', '**/features/**', '**/renderer/**'],
              message: 'core depends on nothing but src/shared',
            },
          ],
        },
      ],
    },
  },
  {
    // Architecture: features use ports and never reach into another layer or feature.
    files: ['src/features/**/*.{ts,vue}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...machineModules, 'electron'].map(viaPorts),
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
  {
    // Only src/platform touches the file system or starts programs. The Electron
    // bootstrap, the shared types and the renderer shell go through ports too.
    files: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/renderer/**/*.{ts,vue}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: machineModules.map(viaPorts) }],
    },
  },
  prettier
);
