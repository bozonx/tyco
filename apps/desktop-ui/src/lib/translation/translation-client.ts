import { keepSurroundingWhitespace } from '@tyco/shared'
import {
  Catalog,
  AiError,
  buildPrompt,
  isAiError,
  chunkText,
  createAiKit,
  type KeyProvider,
  type Transport,
} from '@bozonx/ai-kit'
import {
  detectTranslationProblems,
  renderGlossaryForPrompt,
  renderProblemsForPrompt,
  restoreKeptTerms,
  runTranslationPipeline,
  selectGlossaryForText,
  splitParallelText,
  type GlossaryEntry,
  type TranslationProblem,
  type TranslationQualityReport,
} from '@bozonx/ai-kit/translate'
import {
  TRANSLATION_SECRET_IDS,
  glossaryTranslationFor,
  type TranslationConfig,
  type TranslationGlossaryEntry,
} from '@tyco/shared'

import type { LlmPrompt } from '../llm/llm-prompt'
import { ESTIMATED_CHARACTERS_PER_TOKEN } from '../llm/token-estimate'
import { protectTranslationText } from './protected-text'
import {
  createDeepLProvider,
  createGoogleTranslationProvider,
} from './machine-providers'
import {
  resolveTranslationLanguage,
  translationLanguageLabel,
} from './translation-languages'

const MT_CHUNK_LIMIT_CHARACTERS = 4_500
/** The machine translation models asked for */
const DEEPL_MODEL = 'quality_optimized'
const GOOGLE_TRANSLATE_MODEL = 'nmt'
/** DeepL serves the keys of its free plan from a separate host */
const DEEPL_FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate'
const LLM_CHUNK_LIMIT_CHARACTERS = 36_000
const LLM_REPAIR_COMBINED_LIMIT = 48_000
/**
 * Tokens a character of a chunk may take, at worst (a script like Chinese is
 * near a token per character). A translation pass holds the source and its
 * translation in its context, a repair pass also the earlier translation; the
 * answer holds one translation
 */
const TRANSLATE_CONTEXT_TOKENS_PER_CHUNK_CHARACTER = 2
const REPAIR_CONTEXT_TOKENS_PER_CHUNK_CHARACTER = 3
const OUTPUT_TOKENS_PER_CHUNK_CHARACTER = 1
const CHUNK_MARGIN_TOKENS = 512
/** The end of the previous chunk a chunk is sent with, for its context */
const PRECEDING_CONTEXT_CHARACTERS = 400
/** A smaller chunk means the instructions leave no room for the text */
const MIN_LLM_CHUNK_CHARACTERS = 128

export interface TranslationClientDependencies {
  getConfig: () => TranslationConfig
  getLlmLimits?: () => { contextWindowTokens: number; maxOutputTokens: number }
  transport: Transport
  keys: KeyProvider
  runLlm: (
    prompt: LlmPrompt,
    signal?: AbortSignal,
    options?: { onModel?: (model: { provider: string; model: string }) => void }
  ) => Promise<string>
}

export interface TranslationRunOptions {
  sourceLanguage?: string
  targetLanguage: string
  signal?: AbortSignal
  rules?: string
  /** The user rules of the review in the `always` quality gate */
  qualityGateRules?: string
  onStage?: (stage: 'translating' | 'checking' | 'repairing') => void
}

export interface TranslationRunResult {
  text: string
  provider: string
  kind: 'llm' | 'machine'
  model?: string
  detectedSourceLanguage?: string
  quality: TranslationQualityReport
}

interface FirstPass {
  translation: string
  provider: string
  model?: string
  detectedSourceLanguage?: string
}

export function createTranslationClient(deps: TranslationClientDependencies): {
  translate: (
    text: string,
    options: TranslationRunOptions
  ) => Promise<TranslationRunResult>
} {
  return {
    async translate(text, options) {
      options.signal?.throwIfAborted()
      const config = deps.getConfig()
      // Looked up by the language the user picked, before a provider renames it
      const glossary = toKitGlossary(config.glossary, options.targetLanguage)
      if (config.provider !== 'llm') {
        const targetLanguage = resolveTranslationLanguage(
          options.targetLanguage,
          config.provider,
          'target'
        )
        const sourceLanguage =
          options.sourceLanguage && options.sourceLanguage !== 'auto'
            ? resolveTranslationLanguage(
                options.sourceLanguage,
                config.provider,
                'source'
              )
            : undefined
        if (
          !targetLanguage ||
          (options.sourceLanguage &&
            options.sourceLanguage !== 'auto' &&
            !sourceLanguage)
        )
          throw new AiError(
            'invalid_request',
            'The translation provider does not support the selected language',
            { provider: config.provider }
          )
        options = { ...options, targetLanguage, sourceLanguage }
      }
      options.onStage?.('translating')
      const pipeline = await runTranslationPipeline({
        source: text,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
        glossary,
        qualityGate:
          config.qualityGate === 'onProblems'
            ? 'on_problems'
            : config.qualityGate,
        repairFailure: 'keep_first',
        firstPass: async () => {
          const result =
            config.provider === 'llm'
              ? await translateWithLlm(deps, text, options, glossary)
              : await translateWithMachine(
                  deps,
                  config,
                  text,
                  options,
                  glossary
                )
          options.onStage?.('checking')
          return result
        },
        repair:
          config.qualityGate === 'off'
            ? undefined
            : ({ translation, problems }) => {
                options.onStage?.('repairing')
                return repairWithLlm(
                  deps,
                  text,
                  translation,
                  problems,
                  options,
                  glossary,
                  config.qualityGate === 'always'
                    ? (options.qualityGateRules ?? '')
                    : ''
                )
              },
      })
      options.signal?.throwIfAborted()
      return {
        text: pipeline.translation,
        provider: pipeline.repair?.provider ?? pipeline.first.provider,
        kind: pipeline.repair || config.provider === 'llm' ? 'llm' : 'machine',
        ...(pipeline.repair?.model || pipeline.first.model
          ? { model: pipeline.repair?.model ?? pipeline.first.model }
          : {}),
        ...(pipeline.first.detectedSourceLanguage
          ? { detectedSourceLanguage: pipeline.first.detectedSourceLanguage }
          : {}),
        quality: pipeline.quality,
      }
    },
  }
}

/** The secret of a machine translation service as ai-kit names it */
export const translationKitSecretId = (kitProvider: string): string =>
  kitProvider === 'deepl'
    ? TRANSLATION_SECRET_IDS.deepl
    : TRANSLATION_SECRET_IDS.google

async function translateWithMachine(
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
        restored = fallbackResult.translations[0] ?? ''
      } else {
        throw error
      }
    }

    translated.push(
      restoreTranslationChunkWhitespace(chunks.length, chunk, restored)
    )
  }

  return {
    translation: translated.join(''),
    provider: resultProvider,
    model: resultModel,
    ...(detectedSourceLanguage ? { detectedSourceLanguage } : {}),
  }
}

/** One LLM call of a pass over a text cut into chunks */
interface LlmChunkRequest {
  /** The source text of the chunk */
  source: string
  /** The glossary entries that apply to the chunk */
  glossary: GlossaryEntry[]
  system: string
  user: string
  /** Puts back what the request kept out of the model's reach */
  restore?: (translated: string) => string
  /** The same request without that protection, tried when the model broke it */
  unprotected?: () => LlmChunkRequest
}

/**
 * Sends one request per chunk and joins the answers, with the chunk whitespace
 * and the kept glossary terms restored
 */
async function runLlmChunks<T>(
  deps: TranslationClientDependencies,
  options: TranslationRunOptions,
  chunks: T[],
  requestOf: (chunk: T, index: number) => LlmChunkRequest
): Promise<FirstPass> {
  const output: string[] = []
  let detectedProvider = 'llm'
  let detectedModel: string | undefined
  const send = async (request: LlmChunkRequest): Promise<string> => {
    options.signal?.throwIfAborted()
    const result = await deps.runLlm(
      {
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      },
      options.signal,
      {
        onModel: (info) => {
          detectedProvider = info.provider
          detectedModel = info.model
        },
      }
    )
    options.signal?.throwIfAborted()
    const cleaned = cleanLlmOutput(result, request.source)
    ensureTranslationOutput(cleaned, request.source)
    if (!request.restore) return cleaned
    try {
      return request.restore(cleaned)
    } catch (error) {
      if (!request.unprotected || !isAiError(error)) throw error
      return send(request.unprotected())
    }
  }
  for (const [index, chunk] of chunks.entries()) {
    const request = requestOf(chunk, index)
    const result = await send(request)
    output.push(
      restoreTranslationChunkWhitespace(
        chunks.length,
        request.source,
        restoreKeptTerms({
          source: request.source,
          translated: result,
          entries: request.glossary,
        }).text
      )
    )
  }
  return {
    translation: output.join(''),
    provider: detectedProvider,
    ...(detectedModel ? { model: detectedModel } : {}),
  }
}

function translateWithLlm(
  deps: TranslationClientDependencies,
  text: string,
  options: TranslationRunOptions,
  glossary: GlossaryEntry[]
): Promise<FirstPass> {
  const chunks = chunkText(
    text,
    llmChunkLimit(
      deps,
      options,
      TRANSLATE_CONTEXT_TOKENS_PER_CHUNK_CHARACTER,
      glossary
    )
  )
  return runLlmChunks(deps, options, chunks, (chunk, index) => {
    const applicable = selectGlossaryForText(glossary, chunk)
    const preceding =
      index > 0 ? precedingContext(chunks[index - 1]!) : undefined
    const requestFor = (content: string, isProtected: boolean) => {
      const prompt = buildPrompt({
        system: translationSystem(options, applicable),
        data: [
          ...(preceding
            ? [{ source: 'preceding_text', content: preceding }]
            : []),
          { source: 'source_text', content },
        ],
      })
      const notes = [
        preceding
          ? 'The preceding_text block is the end of the text before it, given only for context: do not translate it.'
          : '',
        isProtected
          ? 'Copy every token like __TYCO_PROTECTED_0__ unchanged, where it belongs in the translation.'
          : '',
      ]
        .filter(Boolean)
        .join(' ')
      return {
        source: chunk,
        glossary: applicable,
        system: prompt.system,
        user: `Translate the source_text block to ${translationLanguageLabel(options.targetLanguage, 'en')} (${normalizeLanguage(options.targetLanguage)}). Preserve Markdown, line breaks, URLs, placeholders and emoji.${notes ? ` ${notes}` : ''} Return only the translation.\n\n${prompt.data}`,
      }
    }
    // Code and links are kept out of the model's reach, like a machine
    // translator's; a model that breaks a token gets the plain chunk instead
    const protectedChunk = protectTranslationText(chunk)
    if (protectedChunk.text === chunk) return requestFor(chunk, false)
    return {
      ...requestFor(protectedChunk.text, true),
      restore: protectedChunk.restore,
      unprotected: () => requestFor(chunk, false),
    }
  })
}

/** The end of a chunk, cut at a word, that the next chunk is sent with */
function precedingContext(chunk: string): string {
  if (chunk.length <= PRECEDING_CONTEXT_CHARACTERS) return chunk.trim()
  const tail = chunk.slice(-PRECEDING_CONTEXT_CHARACTERS)
  const wordStart = tail.search(/\s/)
  return (wordStart === -1 ? tail : tail.slice(wordStart)).trim()
}

function repairWithLlm(
  deps: TranslationClientDependencies,
  source: string,
  translation: string,
  problems: TranslationProblem[],
  options: TranslationRunOptions,
  glossary: GlossaryEntry[],
  qualityGateRules: string
): Promise<FirstPass> {
  const pairs = splitParallelText(
    source,
    translation,
    Math.min(
      LLM_REPAIR_COMBINED_LIMIT,
      llmChunkLimit(
        deps,
        options,
        REPAIR_CONTEXT_TOKENS_PER_CHUNK_CHARACTER,
        glossary
      )
    )
  )
  return runLlmChunks(deps, options, pairs, (pair) => {
    const applicable = selectGlossaryForText(glossary, pair.source)
    const chunkProblems =
      pairs.length > 1
        ? detectTranslationProblems({
            source: pair.source,
            translated: pair.translated,
            sourceLang: options.sourceLanguage,
            targetLang: options.targetLanguage,
            glossary: applicable,
          })
        : problems
    const prompt = buildPrompt({
      system: [
        translationSystem(options, applicable),
        qualityGateRules.trim()
          ? `User instructions for the correction pass:\n${qualityGateRules.trim()}`
          : '',
        renderProblemsForPrompt(chunkProblems),
      ]
        .filter(Boolean)
        .join('\n\n'),
      data: [
        { source: 'source_text', content: pair.source },
        { source: 'translation', content: pair.translated },
      ],
    })
    return {
      source: pair.source,
      glossary: applicable,
      system: prompt.system,
      user: `The translation block is a translation of the source_text block into ${translationLanguageLabel(options.targetLanguage, 'en')} (${normalizeLanguage(options.targetLanguage)}). ${repairInstruction(chunkProblems)} Preserve everything that is already correct and return only the repaired translation.\n\n${prompt.data}`,
    }
  })
}

function translationSystem(
  options: TranslationRunOptions,
  glossary: GlossaryEntry[]
): string {
  return [
    'Translate faithfully while preserving meaning, tone, structure and formatting.',
    options.sourceLanguage && options.sourceLanguage !== 'auto'
      ? `Source language: ${translationLanguageLabel(options.sourceLanguage, 'en')} (${options.sourceLanguage}).`
      : '',
    options.rules?.trim() ? `User instructions:\n${options.rules.trim()}` : '',
    renderGlossaryForPrompt(
      glossary,
      normalizeLanguage(options.targetLanguage)
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * A translated piece of a text cut into `count` pieces. A cut falls after a
 * line break or a space, which the pieces keep; providers drop it from their
 * output, and the joined pieces would run together
 */
function restoreTranslationChunkWhitespace(
  _count: number,
  source: string,
  translated: string
) {
  if (!source.trim()) return source
  return keepSurroundingWhitespace(source, translated)
}

function normalizeLanguage(language: string): string {
  return language.trim()
}

export function cleanLlmOutput(output: string, source: string): string {
  let cleaned = output.trim()

  const untrustedMatch = cleaned.match(
    /^<(?:untrusted_content|translation|source_text)[^>]*>\s*([\s\S]*?)\s*<\/(?:untrusted_content|translation|source_text)>$/i
  )
  if (
    untrustedMatch &&
    !source.includes('<untrusted_content') &&
    !source.includes('<translation')
  ) {
    cleaned = untrustedMatch[1]!.trim()
  }

  const fenceMatch = cleaned.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/)
  if (fenceMatch && !source.trim().startsWith('```')) {
    cleaned = fenceMatch[1]!.trim()
  }

  const prefixMatch = cleaned.match(
    /^(?:Here(?:'s| is) (?:the )?(?:repaired |corrected )?translation:\s*|Translation:\s*)/i
  )
  if (prefixMatch && !source.match(/^(?:Here(?:'s| is)|Translation:)/i)) {
    cleaned = cleaned.slice(prefixMatch[0].length).trim()
  }

  return cleaned
}

function ensureTranslationOutput(result: string, source: string): void {
  if (source.trim() && !result.trim()) {
    throw new AiError(
      'invalid_output',
      'The translation provider returned an empty result'
    )
  }
}

function repairInstruction(problems: TranslationProblem[]): string {
  return problems.length > 0
    ? 'Fix only the listed problems.'
    : 'Review it once and fix any translation errors you find.'
}

/** Reserve context for instructions and an expanded translation, conservatively. */
function llmChunkLimit(
  deps: TranslationClientDependencies,
  options: TranslationRunOptions,
  contextTokensPerCharacter: number,
  glossary: GlossaryEntry[] = []
): number {
  if (!deps.getLlmLimits) return LLM_CHUNK_LIMIT_CHARACTERS
  const { contextWindowTokens: context, maxOutputTokens } = deps.getLlmLimits()
  const baseInstructions = translationSystem(options, glossary).length
  const estimatedInstructionTokens =
    Math.ceil(
      (baseInstructions + PRECEDING_CONTEXT_CHARACTERS) /
        ESTIMATED_CHARACTERS_PER_TOKEN
    ) + 200
  const availableContextTokens =
    context - estimatedInstructionTokens - CHUNK_MARGIN_TOKENS
  const characters = Math.floor(
    availableContextTokens / contextTokensPerCharacter
  )
  const limit = Math.min(
    LLM_CHUNK_LIMIT_CHARACTERS,
    characters,
    Math.floor(maxOutputTokens / OUTPUT_TOKENS_PER_CHUNK_CHARACTER)
  )
  if (limit < MIN_LLM_CHUNK_CHARACTERS)
    throw new AiError(
      'context_length',
      'The translation instructions exceed the language model context'
    )
  return limit
}

/**
 * The glossary for one target language as ai-kit spells it; entries without a
 * translation into that language are left out
 */
function toKitGlossary(
  entries: TranslationGlossaryEntry[],
  targetLanguage: string
): GlossaryEntry[] {
  return entries.flatMap((entry) => {
    const use = glossaryTranslationFor(entry, targetLanguage)
    if (!use) return []
    return [{ term: entry.term, use, doNotTranslate: use === entry.term }]
  })
}
