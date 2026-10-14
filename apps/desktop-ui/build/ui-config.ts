import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { loadEnv, type UserConfig } from 'vite'

import { resolveLocalAiKit } from './local-ai-kit.ts'
import { offlineIconsPlugin } from './offline-icons-plugin.ts'

export const rootDir = resolve(import.meta.dirname, '..')
const srcDir = resolve(rootDir, 'src')
export const envDir = resolve(rootDir, '../..')

/** Shared transforms and aliases; build-only assets stay out of unit tests. */
export function createUiConfig(mode: string, useLocalKit: boolean): UserConfig {
  const env = loadEnv(mode, envDir, '')
  const localAiKit = useLocalKit
    ? resolveLocalAiKit(env.TYCO_LOCAL_AI_KIT, envDir)
    : undefined

  return {
    envDir,
    plugins: [vue(), Components({}), offlineIconsPlugin(srcDir)],
    resolve: {
      alias: [
        { find: '@', replacement: srcDir },
        {
          find: /^@tyco\/shared$/,
          replacement: resolve(envDir, 'packages/shared/src/index.ts'),
        },
        {
          find: /^@tyco\/shared\/appearance$/,
          replacement: resolve(envDir, 'packages/shared/src/appearance.ts'),
        },
        ...(localAiKit?.aliases ?? []),
      ],
    },
    ...(localAiKit
      ? { server: { fs: { allow: [envDir, localAiKit.dir] } } }
      : {}),
  }
}
