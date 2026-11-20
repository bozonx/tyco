import { describe, expect, it } from 'vitest'

import { languageVoiceVariants, preferBaseLanguage } from './voice-languages'

describe('voice languages', () => {
  it('adds the English name, the own name and the endonym of a language', () => {
    const variants = languageVoiceVariants('ru-RU', 'de-DE')
    expect(variants).toContain('Deutsch')
    expect(variants.map((item) => item.toLowerCase())).toContain('german')
  })

  it('names a language in every locale of it', () => {
    expect(languageVoiceVariants('en-US', 'pt-PT')).toContain(
      'português europeu'
    )
    expect(languageVoiceVariants('ru-RU', 'zh-TW')).toContain('繁体中文')
  })

  it('speaks only the first variant of a language by its endonym', () => {
    expect(languageVoiceVariants('ru-RU', 'es')).toContain('Español')
    expect(languageVoiceVariants('ru-RU', 'es-AR')).not.toContain(
      'Español (Argentina)'
    )
    expect(languageVoiceVariants('ru-RU', 'en-US')).toContain('English (US)')
    expect(languageVoiceVariants('ru-RU', 'en-GB')).not.toContain(
      'English (UK)'
    )
  })

  it('prefers a language over its regions and leaves regions alone', () => {
    expect(preferBaseLanguage(['es-AR', 'es', 'es-ES'])).toBe('es')
    expect(preferBaseLanguage(['pt-BR', 'pt-PT'])).toBeUndefined()
    expect(preferBaseLanguage(['es', 'pt-BR'])).toBeUndefined()
  })
})
