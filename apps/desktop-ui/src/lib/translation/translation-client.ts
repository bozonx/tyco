import { AiError } from '@bozonx/ai-kit'
import {
  runTranslationPipeline,
  type GlossaryEntry,
} from '@bozonx/ai-kit/translate'
import {
  glossaryTranslationFor,
  type TranslationGlossaryEntry,
} from '@tyco/shared'

import { repairWithLlm, translateWithLlm } from './llm-translation'
import { translateWithMachine } from './machine-translation'
import { resolveTranslationLanguage } from './translation-languages'
import type {
  TranslationRunOptions,
  TranslationRunResult,
  TranslationClientDependencies,
} from './translation-pass'

export { cleanLlmOutput } from './llm-translation'
export { translationKitSecretId } from './machine-translation'
export type {
  TranslationClientDependencies,
  TranslationRunOptions,
  TranslationRunResult,
} from './translation-pass'

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
