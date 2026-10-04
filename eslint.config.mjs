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

/**
 * NFR-004: a program is started with an executable and an argument array (Shell.run,
 * spawn without a shell). Nothing may run a command line.
 */
const commandLine = 'never run a command string: ports.shell.run(exe, args[]) only (NFR-004)';
const noShell = [
  {
    selector: 'CallExpression[callee.name=/^(exec|execSync|execFile|execFileSync)$/]',
    message: commandLine,
  },
  {
    selector: 'CallExpression[callee.property.name=/^(execSync|execFile|execFileSync)$/]',
    message: commandLine,
  },
  {
    selector:
      'ImportDeclaration[source.value=/^(node:)?child_process$/] ImportSpecifier[imported.name=/^(exec|execSync|execFile|execFileSync)$/]',
    message: commandLine,
  },
  { selector: 'Property[key.name="shell"][value.value=true]', message: commandLine },
  {
    selector:
      'CallExpression[callee.name=/^spawn(Sync)?$/] > ObjectExpression > Property[key.name="shell"]:not([value.value=false])',
    message: 'spawn never gets a shell (NFR-004)',
  },
];

/**
 * PLAT-008: KnownFolders (src/platform/windows/knownFolders.ts) is the only module that
 * computes a user or system path. Everything else asks ctx.ports.folders, so a redirected
 * run (tests, scenarios, RIGREADY_HOME) can never reach the real profile.
 */
const PATH_VARIABLES =
  '/^(USERPROFILE|HOME|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|ProgramFiles|ProgramFiles\\(x86\\)|ProgramW6432|ProgramData|PUBLIC|ALLUSERSPROFILE|OneDrive|SystemRoot|windir|TEMP|TMP|RIGREADY_HOME)$/i';
const viaFolders = 'user and system folders come from ctx.ports.folders (KnownFolders), PLAT-008';
const noUserPaths = [
  { selector: 'CallExpression[callee.property.name=/^(homedir|tmpdir)$/]', message: viaFolders },
  {
    selector: `MemberExpression[object.object.name="process"][object.property.name="env"][property.name=${PATH_VARIABLES}]`,
    message: viaFolders,
  },
  {
    selector: `MemberExpression[object.object.name="process"][object.property.name="env"][property.value=${PATH_VARIABLES}]`,
    message: viaFolders,
  },
];

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
      // Other agents' git worktrees live here; each is linted in its own tree.
      '.claude/**',
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
  {
    // NFR-004 and PLAT-008, for everything that ships (tests may read the environment and
    // build fixtures as they like; tests/unit/shellAudit.test.ts and knownFolders.test.ts
    // scan the same sources as text).
    files: ['src/**/*.{ts,vue}', 'scripts/**/*.{ts,mjs}'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...noShell, ...noUserPaths] },
  },
  {
    // The one module that computes user paths.
    files: ['src/platform/windows/knownFolders.ts'],
    rules: { 'no-restricted-syntax': ['error', ...noShell] },
  },
  prettier
);
