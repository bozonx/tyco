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
          { name: 'language', value: 'en-GB', variants: ['British English'] },
        ],
      },
    ]
    expect(
      resolveVoice(routes, 'translate to British English: Hello!').candidates[0]
    ).toMatchObject({ parameters: { language: 'en-GB' }, text: 'Hello!' })
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
          { name: 'language', value: 'en-GB', variants: ['British English'] },
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
  it('finds a command repeated in a new sentence and drops the failed attempt', () => {
    const transcript = 'Copi this, hello. Copy this: Hello. How are you?'
    const result = resolveVoice([route('copy', 'copy this')], transcript)
    expect(result.kind).toBe('match')
    expect(result.candidates[0]).toMatchObject({
      text: 'Hello. How are you?',
      commandOffset: transcript.indexOf('Copy'),
      consumedWordCount: 2,
    })
    expect(
      resolveVoice([route('copy', 'copy this')], 'copy this Hello')
        .candidates[0]?.commandOffset
    ).toBe(0)
  })
  it('locks the first recognized command and keeps later command phrases as text', () => {
    const routes = [route('copy', 'copy this'), route('ask', 'ask chat')]
    expect(
      resolveVoice(routes, 'copy this Hi. Ask chat why?').candidates[0]
    ).toMatchObject({ commandId: 'copy', text: 'Hi. Ask chat why?' })
    expect(
      resolveVoice(routes, 'Noise. Copy this Hi. Ask chat why?').candidates[0]
    ).toMatchObject({ commandId: 'copy', text: 'Hi. Ask chat why?' })
  })
  it('looks for a repeated command only at sentence boundaries', () => {
    expect(
      resolveVoice([route('copy', 'copy this')], 'well copy this Hello').kind
    ).toBe('none')
    expect(
      resolveVoice([route('copy', 'copy this')], 'well, copy this Hello').kind
    ).toBe('none')
    expect(
      resolveVoice([route('copy', 'copy this')], 'Well! Copy this Hello')
        .candidates[0]?.text
    ).toBe('Hello')
  })
  it('lets a repeated command correct an unknown or unfinished parameter', () => {
    const routes: VoiceRoute[] = [
      {
        commandId: 'en',
        phrase: 'translate to',
        parameters: [
          { name: 'language', value: 'en-US', variants: ['English'] },
        ],
      },
    ]
    expect(
      resolveVoice(routes, 'Translate to Klingon. Translate to English: Hi')
        .candidates[0]
    ).toMatchObject({ commandId: 'en', text: 'Hi' })
    expect(resolveVoice(routes, 'Translate to Klingon. Hi').kind).toBe(
      'parameter-error'
    )
    expect(resolveVoice(routes, 'Noise. Translate to').kind).toBe('incomplete')
  })
  it('compiles only opted-in available commands across the entire library', () => {
    const tools = testTools()
    const enabled = script('a', ['save note'])
    expect(
      compileVoiceRoutes(
        [
          enabled,
          { ...enabled, id: 'b', isVoiceEnabled: false },
          { ...enabled, id: 'c', isEnabled: false },
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
  it('uses explicit phrases for saved translations without adding built-in routes', () => {
    const tool = { ...testTools().get('script')!, id: 'core.translate' }
    const tools = { get: () => tool }
    const first = {
      ...script('first', ['my translation']),
      toolId: 'core.translate',
      toolConfig: { language: 'en-US' },
    }
    const second = { ...first, id: 'second' }
    const before = structuredClone(first)
    const routes = compileVoiceRoutes([first, second], tools)
    expect(resolveVoice(routes, 'my translation I am late').kind).toBe(
      'ambiguous'
    )
    expect(
      resolveVoice(
        compileVoiceRoutes([first], tools),
        'my translation I am late'
      ).candidates[0]
    ).toMatchObject({ commandId: 'first', text: 'I am late', parameters: {} })
    expect(resolveVoice(routes, 'translate to English I am late').kind).toBe(
      'none'
    )
    expect(first).toEqual(before)
  })
})

it.each(['-42', '.env', '--help', '!important', '…text', '- item', '**bold**'])(
  'preserves meaningful argument prefix %s',
  (text) => {
    expect(
      resolveVoice([route('a', 'copy')], `copy ${text}`).candidates[0]?.text
    ).toBe(text)
  }
)

it('offers explicit parameter recovery without guessing which unknown words to remove', () => {
  const routes: VoiceRoute[] = [
    {
      commandId: 'en',
      phrase: 'translate to',
      parameters: [{ name: 'language', value: 'en-US', variants: ['English'] }],
    },
  ]
  expect(resolveVoice(routes, 'translate to Klingon Hello!')).toMatchObject({
    kind: 'parameter-error',
    parameterChoices: [
      {
        commandId: 'en',
        parameters: { language: 'en-US' },
        text: 'Klingon Hello!',
      },
    ],
  })
  expect(resolveVoice(routes, 'translate to').parameterChoices?.[0]?.text).toBe(
    ''
  )
})

it('does not add hidden phrases to user commands', () => {
  const tools = { get: () => testTools().get('script') }
  const commands = [
    'core.copy',
    'core.insert',
    'core.correct',
    'core.askInChat',
  ].map((toolId) => ({ ...script(toolId, []), toolId }))
  const routes = compileVoiceRoutes(commands, tools)
  expect(new Set(routes.map((item) => item.commandId))).toEqual(new Set())
  commands[0]!.phrases = ['my clipboard']
  expect(
    resolveVoice(compileVoiceRoutes(commands, tools), 'my clipboard Hello')
      .candidates[0]?.commandId
  ).toBe('core.copy')
})

describe('voice resolver CJK and SOV languages', () => {
  it('resolves continuous Chinese voice command without spaces', () => {
    const routes: VoiceRoute[] = [
      {
        commandId: 'translate-en',
        phrase: '翻译成',
        parameters: [{ name: 'language', value: 'en-US', variants: ['英语'] }],
      },
    ]
    const result = resolveVoice(routes, '翻译成英语你好')
    expect(result.kind).toBe('match')
    expect(result.candidates[0]).toMatchObject({
      commandId: 'translate-en',
      parameters: { language: 'en-US' },
      text: '你好',
    })
  })

  it('resolves Japanese SOV voice command with suffix', () => {
    const routes: VoiceRoute[] = [
      {
        commandId: 'translate-en',
        phrase: '',
        suffix: 'に翻訳して',
        parameters: [{ name: 'language', value: 'en-US', variants: ['英語'] }],
      },
    ]
    const result = resolveVoice(routes, '英語に翻訳してこんにちは')
    expect(result.kind).toBe('match')
    expect(result.candidates[0]).toMatchObject({
      commandId: 'translate-en',
      parameters: { language: 'en-US' },
      text: 'こんにちは',
    })
  })

  it('resolves Korean SOV voice command', () => {
    const routes: VoiceRoute[] = [
      {
        commandId: 'translate-en',
        phrase: '',
        suffix: '번역해',
        parameters: [
          { name: 'language', value: 'en-US', variants: ['영어로', '영어'] },
        ],
      },
    ]
    const result = resolveVoice(routes, '영어로 번역해 안녕하세요')
    expect(result.kind).toBe('match')
    expect(result.candidates[0]).toMatchObject({
      commandId: 'translate-en',
      parameters: { language: 'en-US' },
      text: '안녕하세요',
    })
  })

  it('resolves Turkish SOV voice command', () => {
    const routes: VoiceRoute[] = [
      {
        commandId: 'translate-en',
        phrase: '',
        suffix: 'çevir',
        parameters: [
          {
            name: 'language',
            value: 'en-US',
            variants: ['İngilizceye', 'İngilizce'],
          },
        ],
      },
    ]
    const result = resolveVoice(routes, 'İngilizceye çevir Merhaba dünya')
    expect(result.kind).toBe('match')
    expect(result.candidates[0]).toMatchObject({
      commandId: 'translate-en',
      parameters: { language: 'en-US' },
      text: 'Merhaba dünya',
    })
  })

  it('resolves Kazakh SOV voice command', () => {
    const routes: VoiceRoute[] = [
      {
        commandId: 'translate-en',
        phrase: '',
        suffix: 'аудар',
        parameters: [
          {
            name: 'language',
            value: 'en-US',
            variants: ['ағылшын тіліне', 'ағылшынша'],
          },
        ],
      },
    ]
    const result = resolveVoice(routes, 'ағылшын тіліне аудар Сәлем әлем')
    expect(result.kind).toBe('match')
    expect(result.candidates[0]).toMatchObject({
      commandId: 'translate-en',
      parameters: { language: 'en-US' },
      text: 'Сәлем әлем',
    })
  })
})
