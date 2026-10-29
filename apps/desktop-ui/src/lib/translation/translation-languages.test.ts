import { describe, expect, it } from 'vitest'

import qwen35 from './languages/qwen35.json'

import {
  resolveTranslationLanguage,
  translationLanguageIds,
  translationLanguageLabel,
  translationLanguageOptions,
  translationLanguageSearchNames,
} from './translation-languages'

describe('translation language catalogs', () => {
  it('uses the bounded Qwen3.5 list and preserves existing regional variants', () => {
    const ids = translationLanguageIds('llm', 'target')
    expect(Object.keys(qwen35)).toHaveLength(201)
    expect(ids.length).toBeGreaterThan(201)
    expect(ids.length).toBeLessThan(300)
    expect(ids).toEqual(
      expect.arrayContaining([
        'en',
        'ru',
        'mhr',
        'ars',
        'zh-Hant',
        'es-AR',
        'en-GB',
        'pt-BR',
      ])
    )
    for (const id of ['und', 'mul', 'zxx', 'mis', 'zzj', 'sah', 'eo', 'ace'])
      expect(ids).not.toContain(id)
    expect(resolveTranslationLanguage('zzj', 'llm', 'target')).toBeUndefined()
    for (const id of Object.keys(qwen35))
      expect(resolveTranslationLanguage(id, 'llm', 'target')).toBe(id)
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
    expect(resolveTranslationLanguage('en', 'deepl', 'target')).toBe('en-US')
    expect(resolveTranslationLanguage('pt', 'deepl', 'target')).toBe('pt-PT')
    expect(resolveTranslationLanguage('zh', 'deepl', 'target')).toBe('zh-Hans')
    expect(resolveTranslationLanguage('es-MX', 'llm', 'target')).toBe('es')
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

  it('names languages offline in the interface locale and searches published names', () => {
    expect(translationLanguageLabel('de', 'ru-RU')).toBe('немецкий')
    expect(translationLanguageLabel('zh-Hant', 'en-US')).toContain('Chinese')
    expect(translationLanguageSearchNames('mhr')).toContain('Meadow Mari')
    expect(translationLanguageLabel('dhd', 'en-US')).toBe('Dhundari')
    const options = translationLanguageOptions('deepl', 'ru-RU')
    expect(
      options.every(({ name }) => name && !name.startsWith('language.'))
    ).toBe(true)
  })
})
