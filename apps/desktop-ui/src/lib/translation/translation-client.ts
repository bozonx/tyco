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
import type { TranslationConfig } from '@tyco/shared'

import type { LlmPrompt } from '../llm/llm-prompt'
import { protectTranslationText } from './protected-text'

const MT_CHUNK_LIMIT = 4_500
const LLM_CHUNK_LIMIT = 36_000
const LLM_REPAIR_COMBINED_LIMIT = 48_000

export interface TranslationClientDeps {
  getConfig: () => TranslationConfig
  transport: Transport
  keys: KeyProvider
  runLlm: (prompt: LlmPrompt, signal?: AbortSignal) => Promise<string>
}

export interface TranslationRunOptions {
  sourceLanguage?: string
  targetLanguage: string
  signal?: AbortSignal
  rules?: string
  onStage?: (stage: 'translating' | 'checking' | 'repairing') => void
}

export interface TranslationRunResult {
  text: string
  provider: string
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

export function createTranslationClient(deps: TranslationClientDeps): {
  translate: (
    text: string,
    options: TranslationRunOptions
  ) => Promise<TranslationRunResult>
} {
  return {
    async translate(text, options) {
      const config = deps.getConfig()
      const glossary: GlossaryEntry[] = config.glossary
      options.onStage?.('translating')
      const pipeline = await runTranslationPipeline({
        source: text,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
        glossary,
        qualityGate: config.qualityGate,
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
                  glossary
                )
              },
      })
      return {
        text: pipeline.translation,
        provider: pipeline.repair?.provider ?? pipeline.first.provider,
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

async function translateWithMachine(
  deps: TranslationClientDeps,
  config: TranslationConfig,
  text: string,
  options: TranslationRunOptions
): Promise<FirstPass> {
  const provider = config.provider === 'deepl' ? 'deepl' : 'google-translate'
  const model = provider === 'deepl' ? 'quality_optimized' : 'nmt'
  const baseUrl =
    provider === 'deepl' && config.deeplEndpoint === 'free'
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
  })
  const applicableGlossary = selectGlossaryForText(config.glossary, text)
  const protectedText = protectTranslationText(
    text,
    applicableGlossary
      .filter((entry) => entry.doNotTranslate)
      .map((entry) => entry.term)
  )
  const chunks = chunkText(protectedText.text, MT_CHUNK_LIMIT)
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
    translated.push(result.translations[0] ?? '')
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

async function translateWithLlm(
  deps: TranslationClientDeps,
  text: string,
  options: TranslationRunOptions,
  glossary: GlossaryEntry[]
): Promise<FirstPass> {
  const translated: string[] = []
  for (const chunk of chunkText(text, LLM_CHUNK_LIMIT)) {
    options.signal?.throwIfAborted()
    const applicable = selectGlossaryForText(glossary, chunk)
    const prompt = buildPrompt({
      system: translationSystem(options, applicable),
      data: [{ source: 'source_text', content: chunk }],
    })
    const result = await deps.runLlm(
      {
        system: prompt.system,
        messages: [
          {
            role: 'user',
            content: `Translate the source_text block to ${normalizeLanguage(options.targetLanguage)}. Preserve Markdown, line breaks, URLs, placeholders and emoji. Return only the translation.\n\n${prompt.data}`,
          },
        ],
      },
      options.signal
    )
    options.signal?.throwIfAborted()
    ensureTranslationOutput(result, chunk)
    translated.push(
      restoreKeptTerms({
        source: chunk,
        translated: result,
        entries: applicable,
      }).text
    )
  }
  return { translation: translated.join(''), provider: 'llm' }
}

async function repairWithLlm(
  deps: TranslationClientDeps,
  source: string,
  translation: string,
  problems: TranslationProblem[],
  options: TranslationRunOptions,
  glossary: GlossaryEntry[]
): Promise<FirstPass> {
  const repaired: string[] = []
  for (const pair of splitParallelText(
    source,
    translation,
    LLM_REPAIR_COMBINED_LIMIT
  )) {
    options.signal?.throwIfAborted()
    const applicable = selectGlossaryForText(glossary, pair.source)
    const prompt = buildPrompt({
      system: [
        translationSystem(options, applicable),
        renderProblemsForPrompt(problems),
      ]
        .filter(Boolean)
        .join('\n\n'),
      data: [
        { source: 'source_text', content: pair.source },
        { source: 'translation', content: pair.translated },
      ],
    })
    const result = await deps.runLlm(
      {
        system: prompt.system,
        messages: [
          {
            role: 'user',
            content: `The translation block is a translation of the source_text block into ${normalizeLanguage(options.targetLanguage)}. ${repairInstruction(problems)} Preserve everything that is already correct and return only the repaired translation.\n\n${prompt.data}`,
          },
        ],
      },
      options.signal
    )
    options.signal?.throwIfAborted()
    ensureTranslationOutput(result, pair.source)
    repaired.push(
      restoreKeptTerms({
        source: pair.source,
        translated: result,
        entries: applicable,
      }).text
    )
  }
  return { translation: repaired.join(''), provider: 'llm' }
}

function translationSystem(
  options: TranslationRunOptions,
  glossary: GlossaryEntry[]
): string {
  return [
    'Translate faithfully while preserving meaning, tone, structure and formatting.',
    options.rules?.trim() ? `User instructions:\n${options.rules.trim()}` : '',
    renderGlossaryForPrompt(
      glossary,
      normalizeLanguage(options.targetLanguage)
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function normalizeLanguage(language: string): string {
  return language.trim().replaceAll('_', '-')
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
