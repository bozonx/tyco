import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { Alias } from 'vite'

const PACKAGE_NAME = '@bozonx/ai-kit'

export interface LocalAiKit {
  /** Absolute path of the checkout */
  dir: string
  /** Every public entry point of the package, mapped to its TypeScript source */
  aliases: Alias[]
}

type ExportEntry = string | { import?: string }

/**
 * Resolves `@bozonx/ai-kit` to the sources of a local checkout instead of the
 * published package, so kit changes can be tried in dev and tests without a
 * release. `setting` is a path relative to the repository root (or absolute);
 * empty means the published package.
 */
export function resolveLocalAiKit(
  setting: string | undefined,
  repositoryRoot: string
): LocalAiKit | undefined {
  const value = setting?.trim()
  if (!value) return undefined

  const dir = isAbsolute(value) ? value : resolve(repositoryRoot, value)
  const manifestPath = resolve(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`TYCO_LOCAL_AI_KIT: no package.json in ${dir}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string
    exports?: Record<string, ExportEntry>
  }
  if (manifest.name !== PACKAGE_NAME) {
    throw new Error(`TYCO_LOCAL_AI_KIT: ${dir} is not ${PACKAGE_NAME}`)
  }

  const aliases: Alias[] = []
  for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
    const target = typeof entry === 'string' ? entry : entry.import
    const source = target?.match(/^\.\/dist\/(.+)\.js$/)?.[1]
    if (!source) continue
    const specifier = PACKAGE_NAME + subpath.slice(1)
    aliases.push({
      find: new RegExp(`^${specifier.replace(/[/.]/g, '\\$&')}$`),
      replacement: resolve(dir, 'src', `${source}.ts`),
    })
  }

  return { dir, aliases }
}
