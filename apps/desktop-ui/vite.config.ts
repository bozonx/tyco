import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, mergeConfig } from 'vite'

import { parseDevPort } from '../../scripts/lib/dev-config.js'
import { offlinePdfAssetsPlugin } from './build/offline-pdf-assets-plugin.ts'
import { createUiConfig, envDir, rootDir } from './build/ui-config.ts'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, envDir, '')
  const isDebugBuild = process.env.TAURI_ENV_DEBUG === 'true'
  // WebKit is supplied by the OS on Linux/macOS. Keep its syntax baseline
  // conservative; Windows uses Chromium-based WebView2.
  const webviewTarget =
    process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13'

  return mergeConfig(createUiConfig(mode, command === 'serve'), {
    plugins: [tailwindcss(), offlinePdfAssetsPlugin()],
    base: './',
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
      outDir: mode === 'browser-test' ? 'dist-browser' : 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      target: webviewTarget,
      minify: !isDebugBuild,
      sourcemap: isDebugBuild,
      rolldownOptions: {
        input: {
          main: resolve(rootDir, 'index.html'),
          ...(mode === 'browser-test'
            ? { catalog: resolve(rootDir, 'ui-catalog.html') }
            : {}),
        },
      },
    },
    server: {
      port: parseDevPort(env.PORT),
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
    },
  })
})
