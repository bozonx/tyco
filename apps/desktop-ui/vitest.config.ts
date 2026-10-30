import { defineConfig, mergeConfig } from 'vitest/config'

import { createUiConfig } from './build/ui-config.ts'

// Tests run in Node by default. jsdom is reserved for Vue code (components,
// views, composables, stores) and for modules that need browser APIs, whose
// tests are named `*.dom.test.ts`. A model test that touches the DOM by
// mistake therefore fails instead of silently getting a browser environment.
const DOM_TEST_PATTERNS = [
  'src/{components,views,composables,stores}/**/*.test.ts',
  'src/**/*.dom.test.ts',
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
              include: ['build/**/*.test.ts', 'src/**/*.test.ts'],
              exclude: DOM_TEST_PATTERNS,
            },
          },
          {
            extends: true,
            test: {
              name: 'unit-dom',
              environment: 'jsdom',
              setupFiles: ['./src/test/setup.ts'],
              include: DOM_TEST_PATTERNS,
            },
          },
        ],
        coverage: {
          provider: 'v8',
          thresholds: {
            lines: 85,
            statements: 85,
            functions: 80,
            branches: 80,
            'src/lib/history/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/llm/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/commands/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/translation/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/chat/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/chat-tools/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/plugins/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/settings/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/ipc/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/ai-profiles/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/stt/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/selection-replace/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
            'src/lib/invocation/**/*.ts': MODEL_COVERAGE_THRESHOLDS,
          },
          reporter: ['text', 'json-summary', 'html', 'lcov'],
          include: ['src/**/*.ts', 'src/**/*.vue'],
          exclude: [
            'src/**/*.test.ts',
            'src/test/**',
            'src/**/testing.ts',
            'src/dev/**',
            'src/types/**',
            'src/env.d.ts',
          ],
        },
      },
    })
  )
)
