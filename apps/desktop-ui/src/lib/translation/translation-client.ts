import { keepSurroundingWhitespace } from '@tyco/shared'
import {
  Catalog,
  AiError,
  buildPrompt,
  chunkText,
  createAiKit,
  type KeyProvider,
  type Transport,
} from '@bozonx/ai-kit'
import {
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
  isGlossaryTermKept,
  type TranslationConfig,
  type TranslationGlossaryEntry,
} from '@tyco/shared'

import type { LlmPrompt } from '../llm/llm-prompt'
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
const LLM_CHUNK_LIMIT_CHARACTERS = 36_000
const LLM_REPAIR_COMBINED_LIMIT = 48_000

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
      const glossary = toKitGlossary(config.glossary)
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
              : await translateWithMachine(deps, config, text, options)
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
  options: TranslationRunOptions
): Promise<FirstPass> {
  const provider = config.provider === 'deepl' ? 'deepl' : 'google-translate'
  const model = provider === 'deepl' ? 'quality_optimized' : 'nmt'
  const baseUrl =
    provider === 'deepl' && config.providers.deepl.endpoint === 'free'
      ? 'https://api-free.deepl.com/v2/translate'
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
  const applicableGlossary = selectGlossaryForText(
    toKitGlossary(config.glossary),
    text
  )
  const protectedText = protectTranslationText(
    text,
    applicableGlossary
      .filter((entry) => entry.doNotTranslate)
      .map((entry) => entry.term)
  )
  const chunks = chunkText(protectedText.text, MT_CHUNK_LIMIT_CHARACTERS)
  const translated: string[] = []
  let detectedSourceLanguage: string | undefined
  let resultProvider = provider
  let resultModel = model
  for (const chunk of chunks) {
    options.signal?.throwIfAborted()
    const result = await kit.translate({
      policy: { taskClass: 'machineTranslate' },
      texts: [chunk],
      targetLanguage: normalizeLanguage(options.targetLanguage),
      ...(options.sourceLanguage && options.sourceLanguage !== 'auto'
        ? { sourceLanguage: normalizeLanguage(options.sourceLanguage) }
        : {}),
      format: 'text',
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })
    options.signal?.throwIfAborted()
    translated.push(
      restoreTranslationChunkWhitespace(
        chunks.length,
        chunk,
        result.translations[0] ?? ''
      )
    )
    detectedSourceLanguage ??= result.detectedSourceLanguage
    resultProvider = result.provider
    resultModel = result.model
  }

  return {
    translation: protectedText.restore(translated.join('')),
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
}

/**
 * Sends one request per chunk and joins the answers, with the chunk whitespace
 * and the kept glossary terms restored
 */
async function runLlmChunks<T>(
  deps: TranslationClientDependencies,
  options: TranslationRunOptions,
  chunks: T[],
  requestOf: (chunk: T) => LlmChunkRequest
): Promise<FirstPass> {
  const output: string[] = []
  let detectedProvider = 'llm'
  let detectedModel: string | undefined
  for (const chunk of chunks) {
    options.signal?.throwIfAborted()
    const request = requestOf(chunk)
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
    ensureTranslationOutput(result, request.source)
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
  const chunks = chunkText(text, llmChunkLimit(deps, options, glossary))
  return runLlmChunks(deps, options, chunks, (chunk) => {
    const applicable = selectGlossaryForText(glossary, chunk)
    const prompt = buildPrompt({
      system: translationSystem(options, applicable),
      data: [{ source: 'source_text', content: chunk }],
    })
    return {
      source: chunk,
      glossary: applicable,
      system: prompt.system,
      user: `Translate the source_text block to ${translationLanguageLabel(options.targetLanguage, 'en')} (${normalizeLanguage(options.targetLanguage)}). Preserve Markdown, line breaks, URLs, placeholders and emoji. Return only the translation.\n\n${prompt.data}`,
    }
  })
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
    Math.min(LLM_REPAIR_COMBINED_LIMIT, llmChunkLimit(deps, options, glossary))
  )
  return runLlmChunks(deps, options, pairs, (pair) => {
    const applicable = selectGlossaryForText(glossary, pair.source)
    const prompt = buildPrompt({
      system: [
        translationSystem(options, applicable),
        qualityGateRules.trim()
          ? `User instructions for the correction pass:\n${qualityGateRules.trim()}`
          : '',
        renderProblemsForPrompt(problems),
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
      user: `The translation block is a translation of the source_text block into ${translationLanguageLabel(options.targetLanguage, 'en')} (${normalizeLanguage(options.targetLanguage)}). ${repairInstruction(problems)} Preserve everything that is already correct and return only the repaired translation.\n\n${prompt.data}`,
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
  count: number,
  source: string,
  translated: string
) {
  if (count < 2) return translated
  if (!source.trim()) return source
  return keepSurroundingWhitespace(source, translated)
}

function normalizeLanguage(language: string): string {
  return language.trim()
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
  glossary: GlossaryEntry[]
): number {
  if (!deps.getLlmLimits) return LLM_CHUNK_LIMIT_CHARACTERS
  const { contextWindowTokens: context, maxOutputTokens } = deps.getLlmLimits()
  const instructions = translationSystem(options, glossary).length
  const characters = Math.floor(context / 3) - instructions - 512
  const limit = Math.min(
    LLM_CHUNK_LIMIT_CHARACTERS,
    characters,
    Math.floor(maxOutputTokens / 2)
  )
  if (limit < 128)
    throw new AiError(
      'context_length',
      'The translation instructions exceed the language model context'
    )
  return limit
}

/** The glossary as ai-kit spells it */
function toKitGlossary(entries: TranslationGlossaryEntry[]): GlossaryEntry[] {
  return entries.map((entry) => ({
    term: entry.term,
    use: entry.translation,
    doNotTranslate: isGlossaryTermKept(entry),
  }))
}
