import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  deepgramLanguageBadge,
  normalizeDeepgramLanguage,
  withDeepgramLanguage,
} from './deepgram-language'

describe('deepgram-language', () => {
  it('normalizes empty and multi to auto', () => {
    expect(normalizeDeepgramLanguage(undefined)).toBe('auto')
    expect(normalizeDeepgramLanguage('')).toBe('auto')
    expect(normalizeDeepgramLanguage('multi')).toBe('auto')
    expect(normalizeDeepgramLanguage('ru-RU')).toBe('ru-RU')
  })

  it('formats compact badge labels for overlays', () => {
    expect(deepgramLanguageBadge('auto', 'Auto')).toBe('Auto')
    expect(deepgramLanguageBadge('multi', 'Auto')).toBe('Auto')
    expect(deepgramLanguageBadge('ru-RU', 'Auto')).toBe('RU')
    expect(deepgramLanguageBadge('en-US', 'Auto')).toBe('EN-US')
    expect(deepgramLanguageBadge('pt-BR', 'Auto')).toBe('PT-BR')
  })

  it('updates deepgram language without mutating the original config', () => {
    const stt = structuredClone(DEFAULT_USER_CONFIG.stt)
    const next = withDeepgramLanguage(stt, 'de-DE')
    expect(next.providers.deepgram.language).toBe('de-DE')
    expect(stt.providers.deepgram.language).toBe('auto')
  })
})
