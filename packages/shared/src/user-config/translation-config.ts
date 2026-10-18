export const TRANSLATION_PROVIDERS = ['deepl', 'google', 'llm'] as const
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]

export const TRANSLATION_QUALITY_GATES = [
  'off',
  'onProblems',
  'always',
] as const
export type TranslationQualityGate = (typeof TRANSLATION_QUALITY_GATES)[number]

export interface TranslationGlossaryEntry {
  term: string
  use: string
  doNotTranslate: boolean
}

/**
 * The keys of the shortcut grids (menu, launcher pages, AI tasks, translation
 * languages), row by row; a grid is stored by key, empty slots are absent
 */
export const SHORTCUT_SLOT_KEYS = [
  'q',
  'w',
  'e',
  'r',
  't',
  'a',
  's',
  'd',
  'f',
  'g',
  'z',
  'x',
  'c',
  'v',
  'b',
] as const
export type ShortcutSlotKey = (typeof SHORTCUT_SLOT_KEYS)[number]
export type ShortcutSlots<T> = Partial<Record<ShortcutSlotKey, T>>

export interface TranslationConfig {
  /** Distinct locales such as `en_US` */
  targetLanguages: ShortcutSlots<string>
  viewMode: 'split' | 'result'
  provider: TranslationProvider
  qualityGate: TranslationQualityGate
  deeplEndpoint: 'free' | 'pro'
  glossary: TranslationGlossaryEntry[]
  /** Extra instructions for the AI correction pass in the `always` mode. */
  qualityGatePrompt: string
}
