import { type CommandConfig, commandTakesSelection } from '@tyco/shared'
import { messages } from '../i18n/messages'
import {
  commandTakesText,
  isCommandAvailable,
} from '../commands/command-runtime'
import type { ToolLookup } from '../tools/tool-types'
import {
  localeMessage,
  openCommandParameters,
  parameterVariants,
} from '../tools/command-parameters'

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

/**
 * Route phrases and parameter variants are a small fixed set, while the live
 * transcript is resolved again on every partial result: their words are
 * tokenized once.
 */
const wordCache = new Map<string, readonly string[]>()
const WORD_CACHE_LIMIT = 10_000
function words(text: string): readonly string[] {
  const cached = wordCache.get(text)
  if (cached) return cached
  const result = tokenize(text).map((token) => token.word)
  if (wordCache.size >= WORD_CACHE_LIMIT) wordCache.clear()
  wordCache.set(text, result)
  return result
}
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

/** A grammar entry lists its spoken variants separated by `;` */
export function grammarVariants(value: string): string[] {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** `{name}` marks where a parameter is spoken in a phrase */
const slotOf = (name: string) => `{${name}}`

/**
 * One phrase with one value of the parameter as a route. Text glued to the
 * slot, such as the Korean `{language}로` or the Japanese `{language}に翻訳`, is
 * spoken as one word with the value, so it becomes part of every variant rather
 * than a word of its own. Without a slot the value follows the phrase.
 */
function parameterRoute(
  commandId: string,
  template: string,
  parameter: VoiceParameter
): VoiceRoute {
  const slot = slotOf(parameter.name)
  const at = template.indexOf(slot)
  if (at < 0) return { commandId, phrase: template, parameters: [parameter] }
  const before = template.slice(0, at)
  const after = template.slice(at + slot.length)
  const gluedBefore = before.match(/\S+$/u)?.[0] ?? ''
  const gluedAfter = after.match(/^\S+/u)?.[0] ?? ''
  return {
    commandId,
    phrase: before.slice(0, before.length - gluedBefore.length).trim(),
    suffix: after.slice(gluedAfter.length).trim(),
    parameters: [
      {
        ...parameter,
        variants: parameter.variants.map(
          (variant) => `${gluedBefore}${variant}${gluedAfter}`
        ),
      },
    ],
  }
}

/**
 * The routes of a command: its phrases, or the phrases of its tool when it has
 * none and leaves a parameter to the caller. The first parameter it leaves is
 * spoken, in the words of every locale, independently of the UI language.
 */
function commandRoutes(
  command: CommandConfig,
  tools: ToolLookup
): VoiceRoute[] {
  const own = command.phrases.filter((phrase) => words(phrase).length)
  const tool = tools.get(command.toolId)
  const [parameter] = openCommandParameters(tool, command.toolConfig)
  if (!parameter)
    return own.map((phrase) => ({
      commandId: command.id,
      phrase,
      parameters: [],
    }))
  const routes: VoiceRoute[] = []
  for (const locale of Object.values(messages)) {
    const defaults = tool?.voicePhrasesKey
      ? localeMessage(locale, tool.voicePhrasesKey)
      : undefined
    const templates = own.length
      ? own
      : grammarVariants(typeof defaults === 'string' ? defaults : '')
    const values = Object.entries(parameterVariants(locale, parameter))
    for (const template of templates)
      for (const [value, spoken] of values)
        routes.push(
          parameterRoute(command.id, template, {
            name: parameter.name,
            value,
            variants: grammarVariants(spoken),
          })
        )
  }
  return routes
}

export function compileVoiceRoutes(
  commands: readonly CommandConfig[],
  tools: ToolLookup,
  includeUnavailable = false
): VoiceRoute[] {
  return commands
    .filter(
      (item) =>
        item.isEnabled &&
        item.isVoiceEnabled &&
        (includeUnavailable || isCommandAvailable(item, tools))
    )
    .flatMap((command) => commandRoutes(command, tools))
}

/** Nested phrases and identical routes deserve a warning before saving. */
export function findVoiceConflicts(
  routes: readonly VoiceRoute[],
  commandId: string
): string[] {
  const expand = (route: VoiceRoute): (readonly string[])[] => {
    let prefixes: (readonly string[])[] = [words(route.phrase)]
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

export type VoiceInputIssue =
  'missing-text' | 'extra-text' | 'missing-selection' | 'missing-parameter'

/** What keeps the command from running on the text and the parameters */
export function voiceInputIssue(
  command: CommandConfig,
  text: string,
  tools: ToolLookup,
  context?: { selectionText: string },
  parameters: Readonly<Record<string, string>> = {}
): VoiceInputIssue | undefined {
  if (commandTakesSelection(command) && !context?.selectionText?.trim()) {
    return 'missing-selection'
  }
  if (
    openCommandParameters(tools.get(command.toolId), command.toolConfig).some(
      (parameter) => !parameters[parameter.name]
    )
  )
    return 'missing-parameter'

  if (commandTakesText(command, tools))
    return text.trim() ? undefined : 'missing-text'
  return text.trim() ? 'extra-text' : undefined
}
