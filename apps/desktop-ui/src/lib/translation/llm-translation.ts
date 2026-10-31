import { AiError, buildPrompt, chunkText, isAiError } from '@bozonx/ai-kit'
import {
  detectTranslationProblems,
  renderGlossaryForPrompt,
  renderProblemsForPrompt,
  restoreKeptTerms,
  selectGlossaryForText,
  splitParallelText,
  type GlossaryEntry,
  type TranslationProblem,
} from '@bozonx/ai-kit/translate'

import { cleanLlmOutput } from '../llm/llm-output'
import { ESTIMATED_CHARACTERS_PER_TOKEN } from '../llm/token-estimate'
import { protectTranslationText } from './protected-text'
import { translationLanguageLabel } from './translation-languages'
import {
  normalizeLanguage,
  restoreChunkWhitespace,
  type FirstPass,
  type TranslationClientDependencies,
  type TranslationRunOptions,
} from './translation-pass'

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
    const cleaned = cleanLlmOutput(result, request.source).trim()
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
      restoreChunkWhitespace(
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

export function translateWithLlm(
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

export function repairWithLlm(
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
