import type { CommandConfig } from '@tyco/shared'
import { messages } from '../i18n/messages'
import {
  commandTakesText,
  isCommandAvailable,
} from '../commands/command-runtime'
import type { ToolLookup } from '../tools/tool-types'

export interface VoiceParameter {
  name: string
  value: string
  variants: readonly string[]
}

export interface VoiceRoute {
  commandId: string
  phrase: string
  parameters: readonly VoiceParameter[]
}

export interface VoiceCandidate {
  commandId: string
  text: string
  parameters: Record<string, string>
  consumedWordCount: number
  textOffset: number
}

export interface VoiceResolution {
  kind: 'none' | 'incomplete' | 'parameter-error' | 'match' | 'ambiguous'
  candidates: VoiceCandidate[]
  parameterChoices?: VoiceCandidate[]
}

interface Token {
  word: string
  end: number
}

/** Comparison never changes the original text or its UTF-16 offsets. */
function tokenize(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map((match) => ({
    word: match[0]
      .toLowerCase()
      .replace(/\u0307/g, '')
      .replace(/\u0451/g, '\u0435'),
    end: match.index + match[0].length,
  }))
}

const words = (text: string) => tokenize(text).map((token) => token.word)
const startsWith = (input: readonly string[], prefix: readonly string[]) =>
  prefix.every((word, index) => input[index] === word)

/**
 * Only whitespace and separator punctuation are removed at the boundary.
 * Quotes, brackets, signs and the punctuation inside the argument survive.
 */
function argumentOffset(text: string, end: number): number {
  const separator =
    text.slice(end).match(/^(?:[,.:;!?…]+(?=\s|$)|[—–-](?=\s|$))?\s*/u)?.[0] ??
    ''
  return end + separator.length
}

export function resolveVoice(
  routes: readonly VoiceRoute[],
  transcript: string
): VoiceResolution {
  const tokens = tokenize(transcript)
  const input = tokens.map((token) => token.word)
  const candidates: VoiceCandidate[] = []
  const parameterChoices: VoiceCandidate[] = []
  let incomplete = false
  let incompleteDepth = 0
  let parameterError = false
  let parameterErrorDepth = 0
  for (const route of routes) {
    const phrase = words(route.phrase)
    if (!phrase.length) continue
    if (input.length < phrase.length && startsWith(phrase, input)) {
      incomplete = true
      incompleteDepth = Math.max(incompleteDepth, input.length)
      continue
    }
    if (!startsWith(input, phrase)) continue
    let offsets = [phrase.length]
    const parameters: Record<string, string> = {}
    for (const parameter of route.parameters) {
      const next: number[] = []
      for (const offset of offsets) {
        const tail = input.slice(offset)
        for (const variant of parameter.variants) {
          const valueWords = words(variant)
          if (!valueWords.length) continue
          if (tail.length < valueWords.length && startsWith(valueWords, tail)) {
            incomplete = true
            incompleteDepth = Math.max(incompleteDepth, offset + tail.length)
          }
          if (startsWith(tail, valueWords))
            next.push(offset + valueWords.length)
        }
      }
      if (!next.length) {
        for (const offset of offsets) {
          const textOffset = argumentOffset(
            transcript,
            tokens[offset - 1]?.end ?? 0
          )
          parameterChoices.push({
            commandId: route.commandId,
            parameters: { ...parameters, [parameter.name]: parameter.value },
            consumedWordCount: offset,
            textOffset,
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
    for (const offset of offsets) {
      const end = tokens[offset - 1]?.end ?? 0
      const textOffset = argumentOffset(transcript, end)
      candidates.push({
        commandId: route.commandId,
        parameters,
        consumedWordCount: offset,
        textOffset,
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
    command.enabled &&
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
      item.enabled &&
      item.isVoiceEnabled &&
      (includeUnavailable || isCommandAvailable(item, tools))
  )) {
    for (const phrase of command.phrases) {
      if (words(phrase).length)
        routes.push({ commandId: command.id, phrase, parameters: [] })
    }
    for (const locale of Object.values(messages)) {
      const grammar = locale.voiceGrammar
      if (command.toolId === 'core.translate') {
        const language = String(command.toolConfig.language ?? '')
        const variants =
          grammar.languages[language as keyof typeof grammar.languages]
        if (variants)
          routes.push({
            commandId: command.id,
            phrase: grammar.translate,
            parameters: [
              {
                name: 'language',
                value: language,
                variants: variants.split(';'),
              },
            ],
          })
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
