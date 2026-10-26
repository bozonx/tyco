import type { CommandConfig } from '@tyco/shared'
import { messages } from '../i18n/messages'
import {
  commandTakesText,
  isCommandAvailable,
} from '../commands/command-runtime'
import type { ToolLookup } from '../tools/tool-types'
import { isBuiltInVoiceCommand } from './built-in-voice-commands'

export interface VoiceParameter {
  name: string
  value: string
  variants: readonly string[]
}

export interface VoiceRoute {
  commandId: string
  phrase: string
  suffix?: string
  parameters: readonly VoiceParameter[]
}

export interface VoiceCandidate {
  commandId: string
  text: string
  parameters: Record<string, string>
  /** Words of the command and its parameters, counted from `commandOffset` */
  consumedWordCount: number
  textOffset: number
  /**
   * Where the command phrase starts. Anything before it is a failed attempt the
   * user spoke over by starting a new sentence; 0 means nothing was dropped.
   */
  commandOffset: number
}

export interface VoiceResolution {
  kind: 'none' | 'incomplete' | 'parameter-error' | 'match' | 'ambiguous'
  candidates: VoiceCandidate[]
  parameterChoices?: VoiceCandidate[]
}

interface Token {
  word: string
  start: number
  end: number
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : undefined

/** Comparison never changes the original text or its UTF-16 offsets. */
function tokenize(text: string): Token[] {
  if (segmenter) {
    const tokens: Token[] = []
    for (const seg of segmenter.segment(text)) {
      if (seg.isWordLike && /[\p{L}\p{M}\p{N}]/u.test(seg.segment)) {
        tokens.push({
          word: seg.segment
            .toLowerCase()
            .replace(/\u0307/g, '')
            .replace(/\u0451/g, '\u0435'),
          start: seg.index,
          end: seg.index + seg.segment.length,
        })
      }
    }
    return tokens
  }
  return [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map((match) => ({
    word: match[0]
      .toLowerCase()
      .replace(/\u0307/g, '')
      .replace(/\u0451/g, '\u0435'),
    start: match.index,
    end: match.index + match[0].length,
  }))
}

const words = (text: string) => tokenize(text).map((token) => token.word)
const startsWith = (input: readonly string[], prefix: readonly string[]) =>
  prefix.every((word, index) => input[index] === word)

/**
 * Only whitespace and separator punctuation are removed at the boundary.
 * Quotes, brackets, signs and the punctuation inside the argument survive. A
 * dash set off by spaces is a separator too, unless it is a hyphen, which may
 * start a list item.
 */
function argumentOffset(text: string, end: number): number {
  const separator =
    text
      .slice(end)
      .match(
        /^(?:[,.:;!?…]+(?=\s|$)|[—–-](?=\s|$)|\s+[—–](?=\s|$))?\s*/u
      )?.[0] ?? ''
  return end + separator.length
}

/** Token indices that open a sentence: the first one, then after . ! ? … */
function sentenceStarts(
  transcript: string,
  tokens: readonly Token[]
): number[] {
  const starts = [0]
  for (let index = 1; index < tokens.length; index++) {
    const gap = transcript.slice(tokens[index - 1]!.end, tokens[index]!.start)
    // a sentence ends with its mark and a space: `3.5` or `v1.2` goes on
    if (/[.!?…]/u.test(gap) && /\s/u.test(gap)) starts.push(index)
  }
  return starts
}

/**
 * A command is looked for at the start of the transcript first. When it is not
 * there, the user may have spoken over a failed attempt, so every later
 * sentence is tried in order. The first recognized command wins and the rest of
 * the transcript is its text, even if it repeats a command phrase. An
 * incomplete or unknown parameter does not stop the search: the user may be
 * correcting it.
 */
export function resolveVoice(
  routes: readonly VoiceRoute[],
  transcript: string
): VoiceResolution {
  const tokens = tokenize(transcript)
  let fallback: VoiceResolution | undefined
  for (const start of sentenceStarts(transcript, tokens)) {
    const result = resolveFrom(
      routes,
      transcript,
      tokens.slice(start),
      start ? tokens[start]!.start : 0
    )
    if (result.kind === 'match' || result.kind === 'ambiguous') return result
    if (result.kind !== 'none') fallback ??= result
  }
  return fallback ?? { kind: 'none', candidates: [], parameterChoices: [] }
}

function resolveFrom(
  routes: readonly VoiceRoute[],
  transcript: string,
  tokens: readonly Token[],
  commandOffset: number
): VoiceResolution {
  const input = tokens.map((token) => token.word)
  const candidates: VoiceCandidate[] = []
  const parameterChoices: VoiceCandidate[] = []
  let incomplete = false
  let incompleteDepth = 0
  let parameterError = false
  let parameterErrorDepth = 0
  for (const route of routes) {
    const phrase = words(route.phrase)
    const suffixWords = route.suffix ? words(route.suffix) : []
    if (!phrase.length && !route.parameters.length) continue
    if (!phrase.length && !input.length) continue
    if (phrase.length) {
      if (
        input.length > 0 &&
        input.length < phrase.length &&
        startsWith(phrase, input)
      ) {
        incomplete = true
        incompleteDepth = Math.max(incompleteDepth, input.length)
        continue
      }
      if (!startsWith(input, phrase)) continue
    }
    let offsets = [phrase.length]
    let failedToMatchLeadingParameter = false
    const parameters: Record<string, string> = {}
    for (const parameter of route.parameters) {
      const next: number[] = []
      for (const offset of offsets) {
        const tail = input.slice(offset)
        for (const variant of parameter.variants) {
          const valueWords = words(variant)
          if (!valueWords.length) continue
          if (
            tail.length > 0 &&
            tail.length < valueWords.length &&
            startsWith(valueWords, tail)
          ) {
            incomplete = true
            incompleteDepth = Math.max(incompleteDepth, offset + tail.length)
          }
          if (startsWith(tail, valueWords))
            next.push(offset + valueWords.length)
        }
      }
      if (!next.length) {
        if (!phrase.length) {
          failedToMatchLeadingParameter = true
          break
        }
        for (const offset of offsets) {
          const textOffset = argumentOffset(
            transcript,
            tokens[offset - 1]?.end ?? commandOffset
          )
          parameterChoices.push({
            commandId: route.commandId,
            parameters: { ...parameters, [parameter.name]: parameter.value },
            consumedWordCount: offset,
            textOffset,
            commandOffset,
            text: transcript.slice(textOffset).trimEnd(),
          })
        }
        if (offsets.some((offset) => input.length > offset)) {
          parameterError = true
          parameterErrorDepth = Math.max(parameterErrorDepth, ...offsets)
        } else {
          incomplete = true
          incompleteDepth = Math.max(incompleteDepth, ...offsets)
        }
      }
      offsets = [...new Set(next)]
      parameters[parameter.name] = parameter.value
    }
    if (failedToMatchLeadingParameter) continue
    if (suffixWords.length) {
      const next: number[] = []
      for (const offset of offsets) {
        const tail = input.slice(offset)
        if (
          tail.length > 0 &&
          tail.length < suffixWords.length &&
          startsWith(suffixWords, tail)
        ) {
          incomplete = true
          incompleteDepth = Math.max(incompleteDepth, offset + tail.length)
        }
        if (startsWith(tail, suffixWords))
          next.push(offset + suffixWords.length)
      }
      if (!next.length && offsets.length) {
        if (offsets.some((offset) => input.length > offset)) {
          parameterError = true
          parameterErrorDepth = Math.max(parameterErrorDepth, ...offsets)
        } else {
          incomplete = true
          incompleteDepth = Math.max(incompleteDepth, ...offsets)
        }
      }
      offsets = [...new Set(next)]
    }
    for (const offset of offsets) {
      const end = tokens[offset - 1]?.end ?? commandOffset
      const textOffset = argumentOffset(transcript, end)
      candidates.push({
        commandId: route.commandId,
        parameters,
        consumedWordCount: offset,
        textOffset,
        commandOffset,
        text: transcript.slice(textOffset).trimEnd(),
      })
    }
  }
  const longest = Math.max(
    0,
    ...candidates.map((item) => item.consumedWordCount)
  )
  if (
    parameterError &&
    parameterErrorDepth >= longest &&
    parameterErrorDepth > incompleteDepth
  ) {
    return { kind: 'parameter-error', candidates: [], parameterChoices }
  }
  if (incompleteDepth > longest)
    return { kind: 'incomplete', candidates: [], parameterChoices }
  const unique = new Map<string, VoiceCandidate>()
  for (const candidate of candidates) {
    if (candidate.consumedWordCount !== longest) continue
    unique.set(
      JSON.stringify([
        candidate.commandId,
        candidate.textOffset,
        candidate.parameters,
      ]),
      candidate
    )
  }
  const result = [...unique.values()]
  return {
    kind:
      result.length > 1
        ? 'ambiguous'
        : result.length
          ? 'match'
          : incomplete
            ? 'incomplete'
            : parameterError
              ? 'parameter-error'
              : 'none',
    candidates: result,
    parameterChoices: result.length ? undefined : parameterChoices,
  }
}

export function isVoiceCommand(
  command: CommandConfig,
  tools: ToolLookup
): boolean {
  return (
    command.isEnabled &&
    command.isVoiceEnabled &&
    isCommandAvailable(command, tools)
  )
}

/** All spoken languages are compiled, independently of the UI language. */
export function compileVoiceRoutes(
  commands: readonly CommandConfig[],
  tools: ToolLookup,
  includeUnavailable = false
): VoiceRoute[] {
  const routes: VoiceRoute[] = []
  for (const command of commands.filter(
    (item) =>
      item.isEnabled &&
      item.isVoiceEnabled &&
      (includeUnavailable || isCommandAvailable(item, tools))
  )) {
    for (const phrase of command.phrases) {
      if (words(phrase).length)
        routes.push({ commandId: command.id, phrase, parameters: [] })
    }
    if (!isBuiltInVoiceCommand(command)) continue
    for (const locale of Object.values(messages)) {
      const grammar = locale.voiceGrammar
      if (command.toolId === 'core.translate') {
        const language = String(command.toolConfig.language ?? '')
        const variants =
          grammar.languages[language as keyof typeof grammar.languages]
        if (variants) {
          for (const template of grammar.translate.split(';')) {
            const trimmed = template.trim()
            if (!trimmed) continue
            if (trimmed.includes('{language}') || trimmed.includes('~')) {
              const [prefix = '', suffix = ''] =
                trimmed.split(/\{language\}|~/u)
              routes.push({
                commandId: command.id,
                phrase: prefix.trim(),
                suffix: suffix.trim(),
                parameters: [
                  {
                    name: 'language',
                    value: language,
                    variants: variants.split(';'),
                  },
                ],
              })
            } else {
              routes.push({
                commandId: command.id,
                phrase: trimmed,
                parameters: [
                  {
                    name: 'language',
                    value: language,
                    variants: variants.split(';'),
                  },
                ],
              })
            }
          }
        }
      } else if (command.toolId === 'core.askInChat') {
        routes.push({
          commandId: command.id,
          phrase: grammar.actions.askInChat,
          parameters: [],
        })
      }
    }
  }
  return routes
}

/** Nested phrases and identical routes deserve a warning before saving. */
export function findVoiceConflicts(
  routes: readonly VoiceRoute[],
  commandId: string
): string[] {
  const expand = (route: VoiceRoute): string[][] => {
    let prefixes = [words(route.phrase)]
    for (const parameter of route.parameters) {
      prefixes = prefixes.flatMap((prefix) =>
        parameter.variants.map((variant) => [...prefix, ...words(variant)])
      )
    }
    const suffixWords = route.suffix ? words(route.suffix) : []
    if (suffixWords.length) {
      prefixes = prefixes.map((prefix) => [...prefix, ...suffixWords])
    }
    return prefixes
  }
  const own = routes
    .filter((route) => route.commandId === commandId)
    .flatMap(expand)
  return [
    ...new Set(
      routes
        .filter(
          (route) =>
            route.commandId !== commandId &&
            expand(route).some((other) =>
              own.some(
                (prefix) =>
                  startsWith(prefix, other) || startsWith(other, prefix)
              )
            )
        )
        .map((route) => route.commandId)
    ),
  ]
}

export function voiceInputIssue(
  command: CommandConfig,
  text: string,
  tools: ToolLookup
): 'missing-text' | 'extra-text' | undefined {
  if (commandTakesText(command, tools))
    return text.trim() ? undefined : 'missing-text'
  return text.trim() ? 'extra-text' : undefined
}
