import { describe, expect, it } from 'vitest'

import {
  resolveTranslationLanguage,
  translationLanguageIds,
  translationLanguageLabel,
  translationLanguageOptions,
  translationLanguageSearchNames,
} from './translation-languages'

describe('translation language catalogs', () => {
  it('uses the full IANA language registry for any LLM connection', () => {
    const ids = translationLanguageIds('llm', 'target')
    expect(ids.length).toBeGreaterThan(7900)
    expect(ids).toEqual(
      expect.arrayContaining(['en', 'ru', 'eo', 'ace', 'sah', 'es-AR'])
    )
    for (const id of ['und', 'mul', 'zxx', 'mis']) expect(ids).not.toContain(id)
    expect(resolveTranslationLanguage('sh', 'llm', 'target')).toBe('sh')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps DeepL source codes separate from target-only variants', () => {
    expect(translationLanguageIds('deepl', 'target')).toContain('en-GB')
    expect(translationLanguageIds('deepl', 'source')).not.toContain('en-GB')
    expect(translationLanguageIds('deepl', 'source')).toContain('en')
    expect(translationLanguageIds('deepl', 'target')).toContain('zh-Hant')
    expect(translationLanguageIds('deepl', 'target')).not.toContain('sah')
    expect(translationLanguageIds('google', 'target')).toContain('yua')
  })

  it('maps stored locale variants to provider codes without inventing support', () => {
    expect(resolveTranslationLanguage('ru-RU', 'deepl', 'target')).toBe('ru')
    expect(resolveTranslationLanguage('en-US', 'google', 'target')).toBe('en')
    expect(resolveTranslationLanguage('en-GB', 'deepl', 'source')).toBe('en')
    expect(resolveTranslationLanguage('es-AR', 'deepl', 'target')).toBe(
      'es-419'
    )
    expect(resolveTranslationLanguage('zh-TW', 'deepl', 'target')).toBe(
      'zh-Hant'
    )
    expect(resolveTranslationLanguage('zh-Hant', 'deepl', 'source')).toBe('zh')
    expect(resolveTranslationLanguage('zh-Hans', 'google', 'target')).toBe(
      'zh-CN'
    )
    expect(resolveTranslationLanguage('sah', 'deepl', 'target')).toBeUndefined()
    expect(
      resolveTranslationLanguage('xx-invalid', 'google', 'target')
    ).toBeUndefined()
  })

  it('names languages offline in the interface locale and searches registry names', () => {
    expect(translationLanguageLabel('de', 'ru-RU')).toBe('немецкий')
    expect(translationLanguageLabel('zh-Hant', 'en-US')).toContain('Chinese')
    expect(translationLanguageSearchNames('ace')).toContain('Achinese')
    expect(translationLanguageLabel('zzj', 'en-US')).not.toBe('zzj')
    const options = translationLanguageOptions('deepl', 'ru-RU')
    expect(
      options.every(({ name }) => name && !name.startsWith('language.'))
    ).toBe(true)
  })
})
