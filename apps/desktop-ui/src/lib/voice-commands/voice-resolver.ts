import { type CommandConfig, commandTakesSelection } from '@tyco/shared'
import { messages } from '../i18n/messages'
import {
  commandTakesText,
  isCommandAvailable,
} from '../commands/command-runtime'
import type {
  OperationCommandParameter,
  OperationLookup,
} from '../operations/operation-types'
import {
  localeMessage,
  openCommandParameters,
  parameterVariants,
} from '../operations/command-parameters'

export interface VoiceParameter {
  name: string
  value: string
  variants: readonly string[]
  /** See `OperationCommandParameter.preferVoiceValue` */
  preferValue?: (values: readonly string[]) => string | undefined
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
  skippedWordCount?: number
}

export interface VoiceResolution {
  kind: 'none' | 'incomplete' | 'parameter-error' | 'match' | 'ambiguous'
  candidates: VoiceCandidate[]
  parameterChoices?: VoiceCandidate[]
  /** The parameter whose spoken value is not recognized, on `parameter-error` */
  failedParameter?: { commandId: string; name: string }
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

/** Case, the Turkish dotted `İ` and `ё` do not tell words apart */
const normalizeWord = (word: string) =>
  word
    .toLowerCase()
    .replace(/\u0307/g, '')
    .replace(/\u0451/g, '\u0435')

/** Comparison never changes the original text or its UTF-16 offsets. */
function tokenize(text: string): Token[] {
  if (segmenter) {
    const tokens: Token[] = []
    for (const seg of segmenter.segment(text)) {
      if (seg.isWordLike && /[\p{L}\p{M}\p{N}]/u.test(seg.segment)) {
        tokens.push({
          word: normalizeWord(seg.segment),
          start: seg.index,
          end: seg.index + seg.segment.length,
        })
      }
    }
    return tokens
  }
  return [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map((match) => ({
    word: normalizeWord(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }))
}

const words = (text: string): readonly string[] =>
  tokenize(text).map((token) => token.word)

interface RouteWords {
  phrase: readonly string[]
  suffix: readonly string[]
  /** The words of each variant of each parameter, in their order */
  parameters: readonly (readonly (readonly string[])[])[]
}

/**
 * The routes are compiled once, while the live transcript is resolved again on
 * every partial result: the words of a route are tokenized once and live as
 * long as the route does.
 */
const routeWordCache = new WeakMap<VoiceRoute, RouteWords>()
function routeWords(route: VoiceRoute): RouteWords {
  let cached = routeWordCache.get(route)
  if (!cached) {
    cached = {
      phrase: words(route.phrase),
      suffix: route.suffix ? words(route.suffix) : [],
      parameters: route.parameters.map((parameter) =>
        parameter.variants.map(words)
      ),
    }
    routeWordCache.set(route, cached)
  }
  return cached
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
  let failedParameter: VoiceResolution['failedParameter']
  const preferences = new Map<
    string,
    (values: readonly string[]) => string | undefined
  >()
  for (const route of routes) {
    const routeWordList = routeWords(route)
    const phrase = routeWordList.phrase
    const suffixWords = routeWordList.suffix
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
    interface OffsetMatch {
      offset: number
      skipped: number
    }
    let offsets: OffsetMatch[] = [{ offset: phrase.length, skipped: 0 }]
    let failedToMatchLeadingParameter = false
    const parameters: Record<string, string> = {}
    for (const [parameterIndex, parameter] of route.parameters.entries()) {
      if (parameter.preferValue)
        preferences.set(
          `${route.commandId}\u0000${parameter.name}`,
          parameter.preferValue
        )
      const next: OffsetMatch[] = []
      for (const m of offsets) {
        const tail = input.slice(m.offset)
        for (const valueWords of routeWordList.parameters[parameterIndex]!) {
          if (!valueWords.length) continue
          if (
            tail.length > 0 &&
            tail.length < valueWords.length &&
            startsWith(valueWords, tail)
          ) {
            incomplete = true
            incompleteDepth = Math.max(incompleteDepth, m.offset + tail.length)
          }
          if (startsWith(tail, valueWords)) {
            next.push({
              offset: m.offset + valueWords.length,
              skipped: m.skipped,
            })
          } else if (phrase.length > 0 && tail.length > valueWords.length) {
            // Skip filler/hesitation words before the spoken parameter value
            for (
              let skip = 1;
              skip <= tail.length - valueWords.length;
              skip++
            ) {
              if (startsWith(tail.slice(skip), valueWords)) {
                next.push({
                  offset: m.offset + skip + valueWords.length,
                  skipped: m.skipped + skip,
                })
                break
              }
            }
          }
        }
      }
      if (!next.length) {
        if (!phrase.length) {
          failedToMatchLeadingParameter = true
          break
        }
        for (const m of offsets) {
          const textOffset = argumentOffset(
            transcript,
            tokens[m.offset - 1]?.end ?? commandOffset
          )
          parameterChoices.push({
            commandId: route.commandId,
            parameters: { ...parameters, [parameter.name]: parameter.value },
            consumedWordCount: m.offset,
            textOffset,
            commandOffset,
            text: transcript.slice(textOffset).trimEnd(),
          })
        }
        if (offsets.some((m) => input.length > m.offset)) {
          parameterError = true
          const depth = Math.max(...offsets.map((m) => m.offset))
          if (depth > parameterErrorDepth || !failedParameter)
            failedParameter = {
              commandId: route.commandId,
              name: parameter.name,
            }
          parameterErrorDepth = Math.max(parameterErrorDepth, depth)
        } else {
          incomplete = true
          incompleteDepth = Math.max(
            incompleteDepth,
            ...offsets.map((m) => m.offset)
          )
        }
      }
      offsets = next.filter(
        (m, i, arr) =>
          arr.findIndex(
            (o) => o.offset === m.offset && o.skipped === m.skipped
          ) === i
      )
      parameters[parameter.name] = parameter.value
    }
    if (failedToMatchLeadingParameter) continue
    if (suffixWords.length) {
      const next: OffsetMatch[] = []
      for (const m of offsets) {
        const tail = input.slice(m.offset)
        if (
          tail.length > 0 &&
          tail.length < suffixWords.length &&
          startsWith(suffixWords, tail)
        ) {
          incomplete = true
          incompleteDepth = Math.max(incompleteDepth, m.offset + tail.length)
        }
        if (startsWith(tail, suffixWords))
          next.push({
            offset: m.offset + suffixWords.length,
            skipped: m.skipped,
          })
      }
      if (!next.length && offsets.length) {
        if (offsets.some((m) => input.length > m.offset)) {
          parameterError = true
          parameterErrorDepth = Math.max(
            parameterErrorDepth,
            ...offsets.map((m) => m.offset)
          )
        } else {
          incomplete = true
          incompleteDepth = Math.max(
            incompleteDepth,
            ...offsets.map((m) => m.offset)
          )
        }
      }
      offsets = next.filter(
        (m, i, arr) =>
          arr.findIndex(
            (o) => o.offset === m.offset && o.skipped === m.skipped
          ) === i
      )
    }
    for (const m of offsets) {
      const end = tokens[m.offset - 1]?.end ?? commandOffset
      const textOffset = argumentOffset(transcript, end)
      candidates.push({
        commandId: route.commandId,
        parameters,
        consumedWordCount: m.offset,
        skippedWordCount: m.skipped,
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
    return {
      kind: 'parameter-error',
      candidates: [],
      parameterChoices,
      ...(failedParameter ? { failedParameter } : {}),
    }
  }
  if (incompleteDepth > longest)
    return { kind: 'incomplete', candidates: [], parameterChoices }
  const longestCandidates = candidates.filter(
    (item) => item.consumedWordCount === longest
  )
  const minSkipped = Math.min(
    ...longestCandidates.map((item) => item.skippedWordCount ?? 0)
  )
  const unique = new Map<string, VoiceCandidate>()
  for (const candidate of longestCandidates) {
    if ((candidate.skippedWordCount ?? 0) !== minSkipped) continue
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
  const preferred = preferredCandidate(result, preferences)
  if (preferred) return { kind: 'match', candidates: [preferred] }
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
    ...(!result.length && !incomplete && parameterError && failedParameter
      ? { failedParameter }
      : {}),
  }
}

/**
 * Candidates of one command that differ only in the value of one parameter,
 * which the parameter settles: `es` over `es-ES` and `es-AR`
 */
function preferredCandidate(
  candidates: readonly VoiceCandidate[],
  preferences: ReadonlyMap<
    string,
    (values: readonly string[]) => string | undefined
  >
): VoiceCandidate | undefined {
  if (candidates.length < 2) return undefined
  const [first] = candidates as [VoiceCandidate, ...VoiceCandidate[]]
  if (
    candidates.some(
      (c) =>
        c.commandId !== first.commandId || c.textOffset !== first.textOffset
    )
  )
    return undefined
  const names = new Set(candidates.flatMap((c) => Object.keys(c.parameters)))
  const differing = [...names].filter((name) =>
    candidates.some((c) => c.parameters[name] !== first.parameters[name])
  )
  if (differing.length !== 1) return undefined
  const [name] = differing as [string]
  const prefer = preferences.get(`${first.commandId}\u0000${name}`)
  const value = prefer?.(candidates.map((c) => c.parameters[name] ?? ''))
  return value === undefined
    ? undefined
    : candidates.find((c) => c.parameters[name] === value)
}

export function isVoiceCommand(
  command: CommandConfig,
  operations: OperationLookup
): boolean {
  return (
    command.isEnabled &&
    command.isVoiceEnabled &&
    isCommandAvailable(command, operations)
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

/** The spoken variants of a value in the locale and those the parameter adds */
function parameterSpokenVariants(
  localeId: string,
  parameter: OperationCommandParameter,
  value: string,
  localSpoken: string
): string[] {
  return [
    ...new Set([
      ...grammarVariants(localSpoken),
      ...(parameter.voiceVariants?.(localeId, value) ?? []),
    ]),
  ]
}

/**
 * The routes of a command: its phrases, or the phrases of its tool when it has
 * none and leaves a parameter to the caller. The first parameter it leaves is
 * spoken, in the words of every locale, independently of the UI language.
 */
function commandRoutes(
  command: CommandConfig,
  operations: OperationLookup
): VoiceRoute[] {
  const own = command.phrases.filter((phrase) => words(phrase).length)
  const tool = operations.get(command.operationId)
  const [parameter] = openCommandParameters(tool, command.operationConfig)
  if (!parameter)
    return own.map((phrase) => ({
      commandId: command.id,
      phrase,
      parameters: [],
    }))
  const routes: VoiceRoute[] = []
  for (const [localeId, locale] of Object.entries(messages)) {
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
            variants: parameterSpokenVariants(
              localeId,
              parameter,
              value,
              spoken
            ),
            ...(parameter.preferVoiceValue
              ? { preferValue: parameter.preferVoiceValue }
              : {}),
          })
        )
  }
  return routes
}

export function compileVoiceRoutes(
  commands: readonly CommandConfig[],
  operations: OperationLookup,
  includeUnavailable = false
): VoiceRoute[] {
  return commands
    .filter(
      (item) =>
        item.isEnabled &&
        item.isVoiceEnabled &&
        (includeUnavailable || isCommandAvailable(item, operations))
    )
    .flatMap((command) => commandRoutes(command, operations))
}

/** Nested phrases and identical routes deserve a warning before saving. */
export function findVoiceConflicts(
  routes: readonly VoiceRoute[],
  commandId: string
): string[] {
  const expand = (route: VoiceRoute): (readonly string[])[] => {
    const routeWordList = routeWords(route)
    let prefixes: (readonly string[])[] = [routeWordList.phrase]
    for (const variants of routeWordList.parameters) {
      prefixes = prefixes.flatMap((prefix) =>
        variants.map((valueWords) => [...prefix, ...valueWords])
      )
    }
    const suffixWords = routeWordList.suffix
    if (suffixWords.length) {
      prefixes = prefixes.map((prefix) => [...prefix, ...suffixWords])
    }
    return prefixes
  }
  // nested sequences share their first word: only those are compared
  const own = new Map<string, (readonly string[])[]>()
  for (const prefix of routes
    .filter((route) => route.commandId === commandId)
    .flatMap(expand)) {
    const key = prefix[0] ?? ''
    own.set(key, [...(own.get(key) ?? []), prefix])
  }
  const nests = (other: readonly string[]) =>
    [...(own.get(other[0] ?? '') ?? []), ...(own.get('') ?? [])].some(
      (prefix) => startsWith(prefix, other) || startsWith(other, prefix)
    ) ||
    (!other.length && own.size > 0)
  const conflicts = new Set<string>()
  for (const route of routes) {
    if (route.commandId === commandId || conflicts.has(route.commandId))
      continue
    if (expand(route).some(nests)) conflicts.add(route.commandId)
  }
  return [...conflicts]
}

export type VoiceParameterIssue =
  'unspeakable-parameter' | 'unspoken-parameters'

/**
 * What keeps the parameters of the command from being spoken: a phrase names
 * only the first parameter the command leaves open, and only one with values
 * known in advance; a value that comes from the plugin at run time is not
 * spoken
 */
export function voiceParameterIssue(
  command: CommandConfig,
  operations: OperationLookup
): VoiceParameterIssue | undefined {
  const open = openCommandParameters(
    operations.get(command.operationId),
    command.operationConfig
  )
  if (!open.length) return undefined
  if (!commandRoutes(command, operations).length) return 'unspeakable-parameter'
  return open.length > 1 ? 'unspoken-parameters' : undefined
}

export type VoiceInputIssue =
  'missing-text' | 'extra-text' | 'missing-selection' | 'missing-parameter'

/** What keeps the command from running on the text and the parameters */
export function voiceInputIssue(
  command: CommandConfig,
  text: string,
  operations: OperationLookup,
  context?: { selectionText: string },
  parameters: Readonly<Record<string, string>> = {}
): VoiceInputIssue | undefined {
  if (commandTakesSelection(command) && !context?.selectionText?.trim()) {
    return 'missing-selection'
  }
  if (
    openCommandParameters(
      operations.get(command.operationId),
      command.operationConfig
    ).some((parameter) => !parameters[parameter.name])
  )
    return 'missing-parameter'

  if (commandTakesText(command, operations))
    return text.trim() ? undefined : 'missing-text'
  return text.trim() ? 'extra-text' : undefined
}
