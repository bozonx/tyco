import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import prettierConfig from 'eslint-config-prettier'
import unusedImports from 'eslint-plugin-unused-imports'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/dist-browser/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
      '**/.turbo/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.ts', '**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
        ecmaVersion: 'latest',
        extraFileExtensions: ['.vue'],
      },
      globals: globals.browser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'unused-imports': unusedImports,
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
      'vue/require-default-prop': 'off',
      'vue/attribute-hyphenation': ['error', 'always'],
      'vue/v-on-event-hyphenation': ['error', 'always', { autofix: true }],
      'vue/attributes-order': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': 'warn',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    files: ['**/workers/**', '**/plugins/**', '**/stores/desktop-runtime.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: [
      '**/*.test.ts',
      '**/test/**/*.ts',
      'packages/plugin-sdk/src/testing.ts',
    ],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Plain Node scripts and config files: no TS parser, Node globals only.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ignores: [
      'src-tauri/plugin-runtime/*.js',
      'scripts/plugin-runtime-browser.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },

  {
    files: [
      'src-tauri/plugin-runtime/*.js',
      'scripts/plugin-runtime-browser.js',
    ],
    languageOptions: { globals: globals.browser },
  },

  {
    files: [
      'scripts/**/*.ts',
      '**/build/**/*.ts',
      '*.config.js',
      '**/*.config.ts',
      '**/*.test.ts',
      '**/test/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  {
    files: ['packages/plugin-*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../*',
            '@/*',
            '@tyco/shared',
            '@tyco/desktop-ui',
            'pinia',
            'vue',
            '@tauri-apps/*',
          ],
        },
      ],
    },
  },

  {
    files: ['apps/desktop-ui/src/lib/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      'apps/desktop-ui/src/lib/desktop/**',
      'apps/desktop-ui/src/lib/net/tauri-net.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/stores/**',
                '**/components/**',
                '**/views/**',
                '**/composables/**',
                '*.vue',
              ],
              message:
                'Models must depend on injected services, not UI adapters.',
            },
            {
              group: ['@tauri-apps/*'],
              message: 'Use a desktop or network adapter for native APIs.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'apps/desktop-ui/src/components/**/*.vue',
      'apps/desktop-ui/src/views/**/*.vue',
      'apps/desktop-ui/src/stores/**/*.ts',
      'apps/desktop-ui/src/composables/**/*.ts',
      'apps/desktop-ui/src/App.vue',
    ],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message: 'Use the desktop adapters for native APIs.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['apps/desktop-ui/src/**/*.ts', 'apps/desktop-ui/src/**/*.vue'],
    ignores: ['**/*.test.ts', '**/test/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  prettierConfig
)
