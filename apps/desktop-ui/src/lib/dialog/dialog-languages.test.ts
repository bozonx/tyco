import { describe, expect, it } from 'vitest'

import { dialogLanguageOptions, dialogRouteLabel } from './dialog-languages'

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

describe('dialogRouteLabel', () => {
  const base = {
    labelOf: (id: string) => `name ${id}`,
    translate: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${params.from} ${params.to}` : key,
  }

  it('reads from the other side to the target when the source is asked for', () => {
    expect(
      dialogRouteLabel({
        ...base,
        translationTargetLanguage: 'ru-RU',
        remoteLanguage: 'en-US',
      })
    ).toBe('dialog.route name en-US name ru-RU')
    expect(
      dialogRouteLabel({
        ...base,
        translationTargetLanguage: '',
        remoteLanguage: 'auto',
      })
    ).toBe('dialog.route dialog.languageAuto dialog.noTranslation')
  })

  it('names only the target when the provider follows the speech', () => {
    expect(
      dialogRouteLabel({
        ...base,
        translationTargetLanguage: 'ru-RU',
        remoteLanguage: undefined,
      })
    ).toBe('name ru-RU')
  })
})
