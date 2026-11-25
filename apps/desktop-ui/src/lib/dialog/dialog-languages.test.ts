import { describe, expect, it } from 'vitest'

import {
  dialogLanguageCode,
  dialogLanguageOptions,
  dialogRouteLabel,
} from './dialog-languages'

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

describe('dialogLanguageCode', () => {
  it('formats language tags to uppercase codes', () => {
    expect(dialogLanguageCode('en-US')).toBe('EN')
    expect(dialogLanguageCode('ru-RU')).toBe('RU')
    expect(dialogLanguageCode('de')).toBe('DE')
    expect(dialogLanguageCode('zh-CN')).toBe('ZH-CN')
    expect(dialogLanguageCode('zh-TW')).toBe('ZH-TW')
    expect(dialogLanguageCode('auto')).toBe('AUTO')
    expect(dialogLanguageCode('')).toBe('—')
    expect(dialogLanguageCode(undefined)).toBe('—')
  })
})

describe('dialogRouteLabel', () => {
  it('formats remote, target and own language codes with arrow and slash', () => {
    expect(
      dialogRouteLabel({
        translationTargetLanguage: 'ru-RU',
        remoteLanguage: 'en-US',
        ownLanguage: 'ru-RU',
      })
    ).toBe('EN → RU / RU')
    expect(
      dialogRouteLabel({
        translationTargetLanguage: '',
        remoteLanguage: 'auto',
        ownLanguage: 'en-US',
      })
    ).toBe('AUTO → — / EN')
  })

  it('omits own language when Gemini transcription is used', () => {
    expect(
      dialogRouteLabel({
        translationTargetLanguage: 'ru-RU',
        remoteLanguage: 'auto',
        ownLanguage: 'ru-RU',
        isGemini: true,
      })
    ).toBe('AUTO → RU')
    expect(
      dialogRouteLabel({
        translationTargetLanguage: '',
        remoteLanguage: 'auto',
        isGemini: true,
      })
    ).toBe('AUTO → —')
  })
})
