import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildCollection } from './offline-icons-plugin'

describe('offline icon collection', () => {
  it('rejects missing icons even when valid icons are present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tyco-icons-'))
    try {
      await writeFile(
        join(dir, 'Component.vue'),
        'mdi:check mdi:tyco-missing-icon'
      )
      await expect(buildCollection(dir)).rejects.toThrow(
        'mdi:tyco-missing-icon'
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('includes aliases and ignores icon names only used by tests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tyco-icons-'))
    try {
      await writeFile(join(dir, 'Component.vue'), 'mdi:check mdi:clear')
      await writeFile(join(dir, 'component.test.ts'), 'mdi:tyco-missing-icon')
      const collection = await buildCollection(dir)
      expect(collection.icons.check).toBeDefined()
      expect(collection.icons.clear ?? collection.aliases?.clear).toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
