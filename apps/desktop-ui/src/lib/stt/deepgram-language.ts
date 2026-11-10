import type { SttConfig } from '@tyco/shared'

import {
  DICTATION_LANGUAGE_AUTO,
  dictationLanguageFor,
} from './dictation-language'

/** Normalizes a stored Deepgram language setting (`multi` / empty -> `auto`). */
export function normalizeDeepgramLanguage(setting?: string): string {
  const trimmed = setting?.trim()
  if (!trimmed || trimmed === 'multi') return DICTATION_LANGUAGE_AUTO
  return trimmed
}

/** Compact trigger label for the language chip inside recording overlays. */
export function deepgramLanguageBadge(
  setting: string | undefined,
  autoLabel: string
): string {
  const normalized = normalizeDeepgramLanguage(setting)
  if (normalized === DICTATION_LANGUAGE_AUTO) return autoLabel
  return (dictationLanguageFor(normalized) ?? normalized).toUpperCase()
}

/** Returns an updated `SttConfig` with Deepgram's language changed. */
export function withDeepgramLanguage(
  stt: SttConfig,
  language: string
): SttConfig {
  return {
    ...stt,
    providers: {
      ...stt.providers,
      deepgram: {
        ...stt.providers.deepgram,
        language: normalizeDeepgramLanguage(language),
      },
    },
  }
}
