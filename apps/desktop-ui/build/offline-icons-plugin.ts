import { readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

import { getIcons } from '@iconify/utils'
import type { IconifyJSON } from '@iconify/types'
import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:offline-icons'
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`

const SCANNED_EXTENSIONS = new Set(['.vue', '.ts', '.js', '.json'])
const ICON_NAME_PATTERN = /\bmdi:[a-z0-9]+(?:-[a-z0-9]+)*\b/g

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)))
      continue
    }

    if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      files.push(entryPath)
    }
  }

  return files
}

async function collectUsedIconNames(srcDir: string): Promise<string[]> {
  const files = await collectSourceFiles(srcDir)
  const names = new Set<string>()

  for (const file of files) {
    const content = await readFile(file, 'utf8')

    for (const match of content.matchAll(ICON_NAME_PATTERN)) {
      names.add(match[0])
    }
  }

  return [...names].sort()
}

async function buildCollection(srcDir: string): Promise<IconifyJSON> {
  const mdi = (
    (await import('@iconify-json/mdi/icons.json', {
      with: { type: 'json' },
    })) as { default: IconifyJSON }
  ).default

  const used = await collectUsedIconNames(srcDir)
  const subset = getIcons(
    mdi,
    used.map((name) => name.slice('mdi:'.length))
  )

  if (!subset) {
    throw new Error('offline-icons: failed to build the mdi subset')
  }

  const missing = Object.keys(subset.not_found ?? {})

  if (missing.length > 0) {
    throw new Error(
      `offline-icons: unknown mdi icons referenced in sources: ${missing
        .map((name) => `mdi:${name}`)
        .join(', ')}`
    )
  }

  return { ...subset, prefix: 'mdi' }
}

/**
 * Bundles only the icons actually referenced in the sources, so the app never
 * fetches them from the Iconify API at runtime. Exposed as the
 * `virtual:offline-icons` module, which default-exports an `IconifyJSON`.
 */
export function offlineIconsPlugin(srcDir: string): Plugin {
  return {
    name: 'tyco:offline-icons',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return null
      }

      const collection = await buildCollection(srcDir)

      return `export default ${JSON.stringify(collection)}`
    },
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (!SCANNED_EXTENSIONS.has(extname(file))) {
          return
        }

        const module = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)

        if (module) {
          server.moduleGraph.invalidateModule(module)
          server.ws.send({ type: 'full-reload' })
        }
      })
    },
  }
}
