import { defineConfig, mergeConfig } from 'vitest/config'

import { createUiConfig } from './build/ui-config.ts'

export default defineConfig((configEnv) =>
  mergeConfig(
    createUiConfig(configEnv.mode, true),
    defineConfig({
      test: {
        environment: 'jsdom',
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        testTimeout: 10000,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.test.ts', 'build/**/*.test.ts'],
        coverage: {
          provider: 'v8',
          reporter: ['text', 'json', 'html'],
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
