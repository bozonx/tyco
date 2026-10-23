import { describe, expect, it } from 'vitest'
import { createCommand } from '../commands/command-config'
import { testTools } from '../tools/testing'
import { createBuiltInVoiceCommands } from './built-in-voice-commands'
import {
  buildVoiceCatalog,
  isTranslateEntry,
  matchVoiceCatalog,
} from './voice-catalog'

const builtIn = createBuiltInVoiceCommands(testTools(), (key) => key)
const custom = { ...createCommand('script', 'note'), phrases: ['save note'] }
const candidate = (commandId: string) => ({
  commandId,
  text: 'Hello',
  parameters: {},
  consumedWordCount: 1,
  textOffset: 0,
  commandOffset: 0,
})

describe('voice catalog', () => {
  it('shows the standard translation as one row before the user commands', () => {
    const entries = buildVoiceCatalog([custom, ...builtIn])
    expect(entries.map((entry) => entry.group)).toEqual([
      'builtIn',
      'builtIn',
      'custom',
    ])
    const translate = entries.find(isTranslateEntry)!
    expect(translate.commands.length).toBe(builtIn.length - 1)
    expect(entries.at(-1)!.commands).toEqual([custom])
  })
  it('puts the preferred language first for a manual choice', () => {
    const entries = buildVoiceCatalog(builtIn, 'builtin:voice:translate:es-AR')
    expect(entries.find(isTranslateEntry)!.commands[0]!.id).toBe(
      'builtin:voice:translate:es-AR'
    )
  })
  it('marks each row once, with its first candidate', () => {
    const entries = buildVoiceCatalog([...builtIn, custom])
    const first = candidate('builtin:voice:translate:es-AR')
    const matches = matchVoiceCatalog(entries, [
      first,
      candidate('builtin:voice:translate:es-ES'),
      candidate('note'),
      candidate('missing'),
    ])
    expect([...matches.keys()]).toEqual([
      entries.find(isTranslateEntry)!.key,
      'note',
    ])
    expect(matches.get(entries.find(isTranslateEntry)!.key)).toBe(first)
  })
})
