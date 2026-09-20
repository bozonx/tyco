import { readFileSync, readdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import offlineIcons from 'virtual:offline-icons'

const appDir = resolve(import.meta.dirname, '../..')
const srcDir = resolve(appDir, 'src')

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath)
    }

    return ['.vue', '.ts'].includes(extname(entry.name)) ? [entryPath] : []
  })
}

describe('offline assets', () => {
  it('does not load anything from the network in index.html', () => {
    const html = readFileSync(resolve(appDir, 'index.html'), 'utf8')

    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i)
  })

  it('has no inline script, which the production CSP blocks', () => {
    const html = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i

    expect(html).not.toMatch(inlineScript)
  })

  it('bundles every mdi icon referenced in the sources', () => {
    const referenced = new Set<string>()

    for (const file of collectSourceFiles(srcDir)) {
      const content = readFileSync(file, 'utf8')

      for (const match of content.matchAll(
        /\bmdi:[a-z0-9]+(?:-[a-z0-9]+)*\b/g
      )) {
        referenced.add(match[0].slice('mdi:'.length))
      }
    }

    expect(referenced.size).toBeGreaterThan(0)

    // Aliases (e.g. `mdi:clear`) resolve to a differently named source icon.
    const bundled = new Set([
      ...Object.keys(offlineIcons.icons),
      ...Object.keys(offlineIcons.aliases ?? {}),
    ])
    const missing = [...referenced].filter((name) => !bundled.has(name))

    expect(missing).toEqual([])
  })
})
