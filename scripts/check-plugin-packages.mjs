#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(resolve(tmpdir(), 'tyco-plugin-packages-'))
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
    assert.equal(plugin.apiVersion, 1)
    assert.equal(plugin.version, artifact.manifest.version)
    assert.deepEqual(plugin.capabilities, artifact.manifest.capabilities)
    assert.ok(plugin.locales[plugin.defaultLocale])
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
        '<root>\n  <item />\n</root>\n'
      )
    }
    console.log(`Standalone plugin verified: ${plugin.id}`)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
