import { describe, expect, it } from 'vitest'

import { dialogLanguageOptions } from './dialog-languages'

describe('dialogLanguageOptions', () => {
  it('lists off, the menu languages, the current one and the common ones once', () => {
    const options = dialogLanguageOptions({
      targetLanguages: { q: 'ja-JP', w: 'ru-RU' },
      current: 'eo',
      offLabel: 'Off',
      labelOf: (id) => `name ${id}`,
    })
    expect(options.slice(0, 4)).toEqual([
      { id: '', name: 'Off' },
      { id: 'ja-JP', name: 'name ja-JP' },
      { id: 'ru-RU', name: 'name ru-RU' },
      { id: 'eo', name: 'name eo' },
    ])
    const ids = options.map((option) => option.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('en-US')
  })
})
