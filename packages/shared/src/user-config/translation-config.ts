export const TRANSLATION_PROVIDERS = ['deepl', 'google', 'llm'] as const
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]

export const TRANSLATION_QUALITY_GATES = [
  'off',
  'onProblems',
  'always',
] as const
export type TranslationQualityGate = (typeof TRANSLATION_QUALITY_GATES)[number]

/** How a term is translated; a term kept as it is has itself as its translation */
export interface TranslationGlossaryEntry {
  term: string
  /**
   * The translation into a target language without one of its own in
   * `translations`; empty when the term has only per-language translations
   */
  translation: string
  /**
   * Translations into particular languages, by a lowercase language code with
   * an optional region or script (`es`, `pt-BR`, `zh-Hant`)
   */
  translations?: Record<string, string>
}

/** Language codes accepted as keys of `TranslationGlossaryEntry.translations` */
export const GLOSSARY_LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/**
 * The canonical spelling of a glossary language code (`ES_ar` → `es-AR`), or
 * undefined when the text is not a language code
 */
export function normalizeGlossaryLanguage(code: string): string | undefined {
  const [language = '', ...subtags] = code.trim().split(/[-_]/)
  const canonical = [
    language.toLowerCase(),
    ...subtags.map((subtag) =>
      subtag.length === 2
        ? subtag.toUpperCase()
        : subtag.length === 4
          ? subtag[0]!.toUpperCase() + subtag.slice(1).toLowerCase()
          : subtag.toLowerCase()
    ),
  ].join('-')
  return GLOSSARY_LANGUAGE_PATTERN.test(canonical) ? canonical : undefined
}

/**
 * The entry with its texts trimmed and its language codes canonical, or
 * undefined when it has no term or no translation at all
 */
export function normalizeGlossaryEntry(
  entry: TranslationGlossaryEntry
): TranslationGlossaryEntry | undefined {
  const term = entry.term.trim()
  const translation = entry.translation.trim()
  const translations: Record<string, string> = {}
  for (const [code, text] of Object.entries(entry.translations ?? {})) {
    const language = normalizeGlossaryLanguage(code)
    if (language && text.trim()) translations[language] = text.trim()
  }
  const hasTranslations = Object.keys(translations).length > 0
  if (!term || (!translation && !hasTranslations)) return undefined
  const { translations: _translations, ...rest } = entry
  return {
    ...rest,
    term,
    translation,
    ...(hasTranslations ? { translations } : {}),
  }
}

/** Whether the glossary keeps the term untranslated in every language */
export const isGlossaryTermKept = (entry: TranslationGlossaryEntry) =>
  entry.translation === entry.term &&
  Object.keys(entry.translations ?? {}).length === 0

/**
 * How the term is translated into the target language: its own translation,
 * else that of its base language (`es` for `es-AR`), else the default one;
 * undefined when the entry does not cover the language
 */
export function glossaryTranslationFor(
  entry: TranslationGlossaryEntry,
  targetLanguage: string
): string | undefined {
  const language = normalizeGlossaryLanguage(targetLanguage)
  const translations = entry.translations ?? {}
  const base = language?.split('-')[0]
  return (
    (language && translations[language]) ||
    (base && translations[base]) ||
    entry.translation ||
    undefined
  )
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

export interface DeeplTranslationSettings {
  /** The API of a free key (ending in `:fx`) or of a paid one */
  endpoint: 'free' | 'pro'
}

export interface TranslationConfig {
  provider: TranslationProvider
  /** The settings of the machine translation services */
  providers: { deepl: DeeplTranslationSettings }
  /**
   * When the LLM reviews a translation; its rule is
   * `llm.tasks.translation.qualityGateRule`
   */
  qualityGate: TranslationQualityGate
  glossary: TranslationGlossaryEntry[]
  /** The translation menu: distinct locales such as `en-US` by shortcut key */
  targetLanguages: ShortcutSlots<string>
  viewMode: 'split' | 'result'
}
