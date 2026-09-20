import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { defineConfig, loadEnv } from 'vite'

import { offlineIconsPlugin } from './build/offline-icons-plugin.ts'

const rootDir = import.meta.dirname
const srcDir = resolve(rootDir, 'src')

// Tauri ships a fixed webview per platform, so the build can target it directly.
const webviewTarget =
  process.env.TAURI_ENV_PLATFORM === 'darwin' ? 'safari13' : 'chrome105'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = resolve(rootDir, '../..')
  const env = loadEnv(mode, envDir, '')
  const port = parseInt(env.PORT || '3000')
  const isDebugBuild = Boolean(process.env.TAURI_ENV_DEBUG)

  return {
    plugins: [vue(), tailwindcss(), Components({}), offlineIconsPlugin(srcDir)],
    resolve: { alias: { '@': srcDir } },
    base: './',
    // Keep the Tauri CLI output readable.
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      target: webviewTarget,
      minify: !isDebugBuild,
      sourcemap: isDebugBuild,
      rollupOptions: { input: { main: resolve(rootDir, 'index.html') } },
    },
    server: { port, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  }
})
