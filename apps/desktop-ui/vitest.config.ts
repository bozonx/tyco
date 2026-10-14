import { defineConfig, mergeConfig } from 'vitest/config'

import { createUiConfig } from './build/ui-config.ts'

// Only modules independent of DOM APIs belong in the Node project.
const NODE_TEST_PATTERNS = [
  'build/**/*.test.ts',
  'src/lib/{history,llm,commands,invocation,tools,plugins,settings,translation,selection-replace,correction,ai-tasks,logger,diff,locale,input-keys,command-launcher}/**/*.test.ts',
  'src/lib/net/{async-queue,base64,provider-fetch,secrets,secrets-state}.test.ts',
  'src/lib/chat/{context-budget,chat-title,chat-request,chat-history-entry,chat-context,chat-attachment,chat-export,chat-history-list,chat-history-settings,chat-persistence-queue,chat-session-model,chat-generation-model}.test.ts',
  'src/lib/stt/{stt-config,sherpa-provider,deepgram-provider,dictation-language,dictation-ownership,stt-readiness}.test.ts',
  'src/lib/clipboard/copy-text.test.ts',
  'src/lib/i18n/messages.test.ts',
]

const MODEL_COVERAGE_THRESHOLDS = {
  lines: 85,
  statements: 85,
  functions: 90,
  branches: 80,
}

export default defineConfig((configEnv) =>
  mergeConfig(
    createUiConfig(configEnv.mode, true),
    defineConfig({
      test: {
        maxWorkers: 4,
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        testTimeout: 10000,
        unstubGlobals: true,
        unstubEnvs: true,
        projects: [
          {
            extends: true,
            test: {
              name: 'unit-node',
              environment: 'node',
              setupFiles: ['./src/test/setup-node.ts'],
              include: NODE_TEST_PATTERNS,
            },
          },
          {
            extends: true,
            test: {
              name: 'unit-dom',
              environment: 'jsdom',
              setupFiles: ['./src/test/setup.ts'],
              include: ['src/**/*.test.ts'],
              exclude: NODE_TEST_PATTERNS,
            },
          },
        ],
        coverage: {
          provider: 'v8',
          thresholds: {
            'src/lib/history/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/llm/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/commands/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/translation/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
          },
          reporter: ['text', 'json-summary', 'html', 'lcov'],
          include: ['src/**/*.ts', 'src/**/*.vue'],
          exclude: [
            'src/**/*.test.ts',
            'src/test/**',
            'src/types/**',
            'src/env.d.ts',
          ],
        },
      },
    })
  )
)
