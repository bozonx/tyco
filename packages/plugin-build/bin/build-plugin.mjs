#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getIcons } from '@iconify/utils'
import mdi from '@iconify-json/mdi/icons.json' with { type: 'json' }
import { build } from 'vite'

const root = process.cwd()
/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
const sourceFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(dir, entry.name)
      return entry.isDirectory() ? sourceFiles(path) : path
    })
  )
  return nested.flat()
}
const names = new Set()
for (const path of await sourceFiles(resolve(root, 'src'))) {
  if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue
  for (const match of (await readFile(path, 'utf8')).matchAll(
    /\bmdi:([a-z0-9-]+)\b/g
  ))
    names.add(match[1])
}
const icons = names.size
  ? getIcons(mdi, [...names])
  : { prefix: 'mdi', icons: {} }
if (!icons || icons.not_found?.length)
  throw new Error('Plugin contains unknown icons')
await writeFile(
  resolve(root, 'dist/host.js'),
  `import factory from './index.js'; export default () => ({ ...factory(), icons: ${JSON.stringify(icons)} });\n`
)
const virtual = resolve(root, 'plugin-package-entry.ts')
const result = await build({
  configFile: false,
  root,
  plugins: [
    {
      name: 'tyco:plugin-package',
      resolveId(id) {
        return id === virtual ? id : null
      },
      load(id) {
        if (id !== virtual) return null
        return `import factory from ${JSON.stringify(resolve(root, 'src/index.ts'))}; export default () => ({ ...factory(), icons: ${JSON.stringify(icons)} });`
      },
    },
  ],
  build: {
    emptyOutDir: false,
    target: ['chrome105', 'safari13'],
    lib: { entry: virtual, formats: ['es'], fileName: () => 'plugin.js' },
    rollupOptions: { output: { codeSplitting: false } },
  },
})
const builds = Array.isArray(result) ? result : [result]
for (const output of builds.flatMap((value) =>
  'output' in value ? value.output : []
)) {
  if (
    output.type !== 'chunk' ||
    output.fileName !== 'plugin.js' ||
    output.imports.length ||
    output.dynamicImports.some((name) => name !== output.fileName)
  ) {
    throw new Error(
      'Plugin packages must contain one self-contained JavaScript module; external assets and imports are unsupported'
    )
  }
}
const definition = (
  await import(pathToFileURL(resolve(root, 'dist/plugin.js')).href)
).default()
const {
  id,
  version,
  apiVersion,
  capabilities,
  legacyIds,
  label,
  labelKey,
  description,
  descriptionKey,
} = definition
await writeFile(
  resolve(root, 'dist/plugin.tyco-plugin'),
  JSON.stringify({
    manifest: {
      id,
      version,
      apiVersion,
      capabilities,
      legacyIds,
      label,
      labelKey,
      description,
      descriptionKey,
    },
    module: await readFile(resolve(root, 'dist/plugin.js'), 'utf8'),
  }) + '\n'
)
