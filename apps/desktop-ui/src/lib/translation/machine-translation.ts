import { Catalog, chunkText, createAiKit, isAiError } from '@bozonx/ai-kit'
import {
  restoreKeptTerms,
  selectGlossaryForText,
  type GlossaryEntry,
} from '@bozonx/ai-kit/translate'
import { TRANSLATION_SECRET_IDS, type TranslationConfig } from '@tyco/shared'

import {
  createDeepLProvider,
  createGoogleTranslationProvider,
} from './machine-providers'
import { protectTranslationText } from './protected-text'
import {
  normalizeLanguage,
  restoreChunkWhitespace,
  type FirstPass,
  type TranslationClientDependencies,
  type TranslationRunOptions,
} from './translation-pass'

const MT_CHUNK_LIMIT_CHARACTERS = 4_500
/** The machine translation models asked for */
const DEEPL_MODEL = 'quality_optimized'
const GOOGLE_TRANSLATE_MODEL = 'nmt'
/** DeepL serves the keys of its free plan from a separate host */
const DEEPL_FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate'
/** The secret of a machine translation service as ai-kit names it */
export const translationKitSecretId = (kitProvider: string): string =>
  kitProvider === 'deepl'
    ? TRANSLATION_SECRET_IDS.deepl
    : TRANSLATION_SECRET_IDS.google

export async function translateWithMachine(
  deps: TranslationClientDependencies,
  config: TranslationConfig,
  text: string,
  options: TranslationRunOptions,
  glossary: GlossaryEntry[]
): Promise<FirstPass> {
  const provider = config.provider === 'deepl' ? 'deepl' : 'google-translate'
  const model = provider === 'deepl' ? DEEPL_MODEL : GOOGLE_TRANSLATE_MODEL
  const baseUrl =
    provider === 'deepl' && config.providers.deepl.endpoint === 'free'
      ? DEEPL_FREE_ENDPOINT
      : undefined
  const catalog = Catalog.fromObject({
    requirePricing: false,
    models: [
      {
        name: provider,
        kind: 'mt',
        provider,
        model,
        tier: 'standard',
        ...(baseUrl ? { baseUrl } : {}),
        mtCapabilities: { html: true, languageDetection: true },
      },
    ],
    taskClasses: { machineTranslate: [provider] },
  })
  const kit = createAiKit({
    catalog,
    keys: deps.keys,
    transport: deps.transport,
    mtProviders: {
      deepl: createDeepLProvider,
      'google-translate': createGoogleTranslationProvider,
    },
  })
  const applicableGlossary = selectGlossaryForText(glossary, text)
  const keptTerms = applicableGlossary
    .filter((entry) => entry.doNotTranslate)
    .map((entry) => entry.term)
  const chunks = chunkText(text, MT_CHUNK_LIMIT_CHARACTERS)
  const translated: string[] = []
  let detectedSourceLanguage: string | undefined
  let resultProvider = provider
  let resultModel = model

  const translateChunk = async (chunkTextToSend: string) =>
    kit.translate({
      policy: { taskClass: 'machineTranslate' },
      texts: [chunkTextToSend],
      targetLanguage: normalizeLanguage(options.targetLanguage),
      ...(options.sourceLanguage && options.sourceLanguage !== 'auto'
        ? { sourceLanguage: normalizeLanguage(options.sourceLanguage) }
        : {}),
      // Tags, code and placeholders are protected already; HTML mode would
      // fold the line breaks and decode entities of a plain text
      format: 'text',
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })

  for (const chunk of chunks) {
    options.signal?.throwIfAborted()
    const protectedChunk = protectTranslationText(chunk, keptTerms)
    const result = await translateChunk(protectedChunk.text)
    options.signal?.throwIfAborted()
    detectedSourceLanguage ??= result.detectedSourceLanguage
    resultProvider = result.provider
    resultModel = result.model

    let restored: string
    try {
      restored = protectedChunk.restore(result.translations[0] ?? '')
    } catch (error) {
      if (isAiError(error) && protectedChunk.text !== chunk) {
        // Fallback: provider corrupted protected tokens, retry this chunk unprotected
        const fallbackResult = await translateChunk(chunk)
        options.signal?.throwIfAborted()
        resultProvider = fallbackResult.provider
        resultModel = fallbackResult.model
        // without the protection the provider may have translated kept terms
        restored = restoreKeptTerms({
          source: chunk,
          translated: fallbackResult.translations[0] ?? '',
          entries: applicableGlossary.filter((entry) => entry.doNotTranslate),
        }).text
      } else {
        throw error
      }
    }

    translated.push(restoreChunkWhitespace(chunk, restored))
  }

  return {
    translation: translated.join(''),
    provider: resultProvider,
    model: resultModel,
    ...(detectedSourceLanguage ? { detectedSourceLanguage } : {}),
  }
}
