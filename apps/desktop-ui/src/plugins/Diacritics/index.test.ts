import { describe, expect, it } from 'vitest'
import type { EditItem } from '../../lib/edit-menu/edit-menu-store'
import { createPluginTestContext } from '../plugin-test-context'
import diacritics from './index'

describe('diacritics plugin', () => {
  it.each(['general', 'russian', 'spanish'])(
    'requires selection for every operation in %s',
    (profile) => {
      const { ctx, mocks } = createPluginTestContext({ config: { profile } })
      diacritics().init(ctx)
      const items = mocks.registerEditItems.mock.calls[0]![0] as EditItem[]
      expect(items.every((item) => item.selectionOnly)).toBe(true)
      expect(items.some((item) => item.id === 'diacritics-clear')).toBe(true)
      expect(items.some((item) => item.id === 'diacritics-acute')).toBe(true)
      if (profile === 'russian') expect(items).toHaveLength(3)
      if (profile === 'spanish') expect(items).toHaveLength(5)
    }
  )
})
