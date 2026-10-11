import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/** PDF decoding resources ship with the app and use the same URLs in dev. */
export function offlinePdfAssetsPlugin(): Plugin {
  const root = dirname(
    createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  )
  const assets = new Map<string, Buffer>()
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const name of readdirSync(join(root, directory))) {
      if (name.endsWith('.map') || name.startsWith('LICENSE')) continue
      assets.set(
        `pdf-assets/${directory}/${name}`,
        readFileSync(join(root, directory, name))
      )
    }
  }
  return {
    name: 'offline-pdf-assets',
    generateBundle() {
      for (const [fileName, source] of assets)
        this.emitFile({ type: 'asset', fileName, source })
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]?.replace(/^\//, '') || ''
        const source = assets.get(path)
        if (!source) return next()
        response.setHeader(
          'Content-Type',
          path.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream'
        )
        response.end(source)
      })
    },
  }
}
