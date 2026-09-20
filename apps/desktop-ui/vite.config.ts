import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

import Components from 'unplugin-vue-components/vite'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..')
  const env = loadEnv(mode, envDir, '')
  const port = parseInt(env.PORT || '3000')

  return {
    plugins: [vue(), tailwindcss(), Components({/* options */})],
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
    base: './',
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      target: 'es2020',
      rollupOptions: {
        input: { main: resolve(import.meta.dirname, 'index.html') },
      },
      minify: false,
      // minify: "esbuild",
      // minify: "terser",
      // terserOptions: {
      //   compress: {
      //     drop_console: true,
      //     drop_debugger: true,
      //   },
      // },
    },
    optimizeDeps: {
      include: [
        'vue',
        'mini-toastr',
        'pinia',
        'vue-router',
        'vue-i18n',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/commands',
        '@codemirror/lang-markdown',
        '@codemirror/language',
        '@codemirror/language-data',
        '@lezer/highlight',
        'diff',
        'highlight.js',
        'js-beautify',
        'rehype-parse',
        'rehype-remark',
        'remark-gfm',
        'remark-normalize-headings',
        'remark-parse',
        'remark-stringify',
        'remark-truncate-links',
        'unified',
        'unist-util-visit',
        '@iconify/vue',
        '@tauri-apps/api',
      ],
    },
    server: { port: port, strictPort: true },
  }
})
