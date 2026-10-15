import { describe, expect, it } from 'vitest'
import { createCommand } from '../commands/command-config'
import { testTools } from '../tools/testing'
import {
  compileVoiceRoutes,
  findVoiceConflicts,
  resolveVoice,
  voiceInputIssue,
  type VoiceRoute,
} from './voice-resolver'

const route = (commandId: string, phrase: string): VoiceRoute => ({
  commandId,
  phrase,
  parameters: [],
})
const script = (id: string, phrases: string[]) => ({
  ...createCommand('script', id),
  isVoiceEnabled: true,
  phrases,
  toolConfig: { command: 'echo {{TEXT}}' },
})

describe('voice resolver', () => {
  it('preserves original argument spelling, quotes, punctuation and numbers', () => {
    const result = resolveVoice(
      [route('copy', 'copy this')],
      '  COPY, this: “Hello, WORLD!” twenty two.  '
    )
    expect(result.kind).toBe('match')
    expect(result.candidates[0]?.text).toBe('“Hello, WORLD!” twenty two.')
    expect(result.candidates[0]?.textOffset).toBe(14)
  })
  it('normalizes case, whitespace, punctuation and equivalent letters without hidden prefixes', () => {
    expect(
      resolveVoice([route('a', '\u0451\u0436')], '\u0415\u0416: Text')
        .candidates[0]?.text
    ).toBe('Text')
    expect(resolveVoice([route('a', 'backup')], 'run backup').kind).toBe('none')
  })
  it('prefers longer exact routes, merges synonyms and never breaks ties by order', () => {
    const routes = [
      route('a', 'write'),
      route('b', 'write idea'),
      route('b', 'WRITE, IDEA'),
    ]
    expect(
      resolveVoice(routes, 'write idea Hello').candidates.map(
        (item) => item.commandId
      )
    ).toEqual(['b'])
    expect(findVoiceConflicts(routes, 'a')).toEqual(['b'])
    expect(
      resolveVoice([...routes, route('c', 'write idea')], 'write idea Hello')
        .kind
    ).toBe('ambiguous')
  })
  it('parses finite multiword parameters, preserves text and rejects unknown values', () => {
    const routes: VoiceRoute[] = [
      {
        commandId: 'en',
        phrase: 'translate to',
        parameters: [
          { name: 'language', value: 'en_GB', variants: ['British English'] },
        ],
      },
    ]
    expect(
      resolveVoice(routes, 'translate to British English: Hello!').candidates[0]
    ).toMatchObject({ parameters: { language: 'en_GB' }, text: 'Hello!' })
    expect(resolveVoice(routes, 'translate to British').kind).toBe('incomplete')
    expect(resolveVoice(routes, 'translate to Klingon Hello').kind).toBe(
      'parameter-error'
    )
    expect(resolveVoice(routes, 'translate to').kind).toBe('incomplete')
  })
  it('does not send an unknown or incomplete parameter through a shorter text route', () => {
    const routes: VoiceRoute[] = [
      route('generic', 'translate'),
      {
        commandId: 'en',
        phrase: 'translate to',
        parameters: [
          { name: 'language', value: 'en_GB', variants: ['British English'] },
        ],
      },
    ]
    expect(resolveVoice(routes, 'translate to Klingon Hello').kind).toBe(
      'parameter-error'
    )
    expect(resolveVoice(routes, 'translate to British').kind).toBe('incomplete')
  })
  it('recomputes changed beginnings without retaining previous candidates', () => {
    const routes = [route('a', 'copy'), route('b', 'correct')]
    expect(resolveVoice(routes, 'copy Hello').candidates[0]?.commandId).toBe(
      'a'
    )
    expect(resolveVoice(routes, 'correct Hello').candidates[0]?.commandId).toBe(
      'b'
    )
    expect(resolveVoice(routes, 'unrelated').kind).toBe('none')
  })
  it('compiles only opted-in available commands across the entire library', () => {
    const tools = testTools()
    const enabled = script('a', ['save note'])
    expect(
      compileVoiceRoutes(
        [
          enabled,
          { ...enabled, id: 'b', isVoiceEnabled: false },
          { ...enabled, id: 'c', enabled: false },
          { ...enabled, id: 'd', toolId: 'missing' },
        ],
        tools
      ).map((item) => item.commandId)
    ).toEqual(['a'])
    expect(
      compileVoiceRoutes(
        [{ ...enabled, phrases: [], name: 'save note' }],
        tools
      )
    ).toEqual([])
    expect(voiceInputIssue(enabled, '', tools)).toBe('missing-text')
    expect(
      voiceInputIssue(
        { ...enabled, toolConfig: { command: 'backup' } },
        'cancel that',
        tools
      )
    ).toBe('extra-text')
  })
  it('maps translation parameters to saved commands and keeps duplicate languages ambiguous', () => {
    const tool = { ...testTools().get('script')!, id: 'core.translate' }
    const tools = { get: () => tool }
    const first = {
      ...script('first', []),
      toolId: 'core.translate',
      toolConfig: { language: 'en_US' },
    }
    const second = { ...first, id: 'second' }
    const before = structuredClone(first)
    const routes = compileVoiceRoutes([first, second], tools)
    expect(resolveVoice(routes, 'translate to English I am late').kind).toBe(
      'ambiguous'
    )
    expect(
      resolveVoice(
        compileVoiceRoutes([first], tools),
        'translate to English I am late'
      ).candidates[0]
    ).toMatchObject({
      commandId: 'first',
      text: 'I am late',
      parameters: { language: 'en_US' },
    })
    expect(first).toEqual(before)
  })
})
