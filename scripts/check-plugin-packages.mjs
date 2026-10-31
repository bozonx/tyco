#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(resolve(tmpdir(), 'tyco-plugin-packages-'))

/**
 * What the Rust backend knows about bundled plugins: their IDs and which
 * setting grants each notes plugin its notes root.
 */
const pluginsSource = await readFile(
  resolve(root, 'src-tauri/src/services/plugins.rs'),
  'utf8'
)
/** @param {string} name */
const rustConstant = (name) => {
  const match = pluginsSource.match(
    new RegExp(`const ${name}: [^=]+= &\\[([\\s\\S]*?)\\];`)
  )
  assert.ok(match, `${name} is not declared in plugins.rs`)
  return match[1]
}
const bundledIds = new Set(
  Array.from(rustConstant('BUNDLED_IDS').matchAll(/"([^"]+)"/g), (m) => m[1])
)
const bundledNotesFields = new Map(
  Array.from(
    rustConstant('BUNDLED_NOTES_FIELDS').matchAll(
      /\("([^"]+)",\s*"([^"]+)"\)/g
    ),
    (m) => [m[1], m[2]]
  )
)
const seenIds = new Set()
try {
  for (const name of await readdir(resolve(root, 'packages'))) {
    if (
      !name.startsWith('plugin-') ||
      name === 'plugin-sdk' ||
      name === 'plugin-build'
    )
      continue
    const artifact = JSON.parse(
      await readFile(
        resolve(root, 'packages', name, 'dist/plugin.tyco-plugin'),
        'utf8'
      )
    )
    const path = resolve(temporary, `${name}.mjs`)
    await writeFile(path, artifact.module)
    // This directory has no node_modules or access to the application's modules.
    const plugin = (await import(pathToFileURL(path).href)).default()
    assert.equal(typeof plugin.id, 'string')
    assert.equal(typeof plugin.init, 'function')
    assert.equal(plugin.id, artifact.manifest.id)
    assert.equal(plugin.apiVersion, 2)
    assert.equal(plugin.version, artifact.manifest.version)
    assert.deepEqual(plugin.capabilities, artifact.manifest.capabilities)
    assert.ok(plugin.locales[plugin.defaultLocale])
    const packageJson = JSON.parse(
      await readFile(resolve(root, 'packages', name, 'package.json'), 'utf8')
    )
    assert.equal(
      plugin.version,
      packageJson.version,
      `${plugin.id}: the plugin version differs from its package.json`
    )
    assert.ok(
      bundledIds.has(plugin.id),
      `${plugin.id} is missing from BUNDLED_IDS in plugins.rs`
    )
    seenIds.add(plugin.id)
    assert.equal(
      bundledNotesFields.get(plugin.id),
      plugin.capabilities.includes('notes')
        ? (plugin.notesDirectoryField ?? 'pathToNotes')
        : undefined,
      `${plugin.id}: BUNDLED_NOTES_FIELDS in plugins.rs differs from the manifest`
    )
    for (const field of plugin.defaultConfig?.fields ?? [])
      assert.equal(typeof field.name, 'string')
    if (plugin.id === 'WebFormatter') {
      /** @type {{ action(text: string): Promise<string> }[]} */
      const items = []
      await plugin.init({
        registerFormatItems: (/** @type {typeof items} */ values) =>
          items.push(...values),
        getMyConfig: () => ({ language: 'xml' }),
      })
      assert.equal(
        await items[0].action('<root><item/></root>'),
        '<root>\n  <item />\n</root>'
      )
    }
    console.log(`Standalone plugin verified: ${plugin.id}`)
  }
  assert.deepEqual(
    [...bundledIds].filter((id) => !seenIds.has(id)),
    [],
    'BUNDLED_IDS in plugins.rs lists plugins that are not bundled'
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
