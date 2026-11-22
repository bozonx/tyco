import { describe, expect, it } from 'vitest'
import { createCommand } from '../commands/command-config'
import { testOperations, testTranslateOperation } from '../operations/testing'
import {
  compileVoiceRoutes,
  findVoiceConflicts,
  resolveVoice,
  voiceEnabledPatch,
  voiceInputIssue,
  voiceParameterIssue,
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
  operationConfig: { command: 'echo {{TEXT}}' },
})

describe('voice resolver', () => {
  it('drops a spaced dash between the command and its text', () => {
    const routes = [route('note', 'save note')]
    expect(
      resolveVoice(routes, 'save note — buy milk').candidates[0]?.text
    ).toBe('buy milk')
    expect(
      resolveVoice(routes, 'save note -5 degrees').candidates[0]?.text
    ).toBe('-5 degrees')
  })

  it('does not split a sentence at a point inside a number', () => {
    const result = resolveVoice(
      [route('note', 'save note')],
      'version 3.save note text'
    )
    expect(result.kind).toBe('none')
  })

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
    const tools = testOperations()
    const enabled = script('a', ['save note'])
    expect(
      compileVoiceRoutes(
        [
          enabled,
          { ...enabled, id: 'b', isVoiceEnabled: false },
          { ...enabled, id: 'c', isEnabled: false },
          { ...enabled, id: 'd', operationId: 'missing' },
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
        { ...enabled, operationConfig: { command: 'backup' } },
        'cancel that',
        tools
      )
    ).toBe('extra-text')
  })
  it('uses explicit phrases for saved translations without adding built-in routes', () => {
    const tool = { ...testOperations().get('script')!, id: 'core.translate' }
    const tools = { get: () => tool }
    const first = {
      ...script('first', ['my translation']),
      operationId: 'core.translate',
      operationConfig: { language: 'en-US' },
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
  const tools = { get: () => testOperations().get('script') }
  const commands = [
    'core.copy',
    'core.insert',
    'core.correct',
    'core.askInChat',
  ].map((operationId) => ({ ...script(operationId, []), operationId }))
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

  it('validates selection context requirement for commands using {{SELECTION}}', () => {
    const tools = testOperations()
    const selectionScript = {
      ...createCommand('script', 'with-selection'),
      isVoiceEnabled: true,
      phrases: ['summarize'],
      operationConfig: { command: 'echo {{SELECTION}} - {{TEXT}}' },
    }
    expect(voiceInputIssue(selectionScript, 'some text', tools)).toBe(
      'missing-selection'
    )
    expect(
      voiceInputIssue(selectionScript, 'some text', tools, {
        selectionText: '   ',
      })
    ).toBe('missing-selection')
    expect(
      voiceInputIssue(selectionScript, 'some text', tools, {
        selectionText: 'selected text',
      })
    ).toBeUndefined()
  })
})

describe('voice routes of a command parameter', () => {
  const tools = testOperations({}, [testTranslateOperation()])
  const translate = {
    ...createCommand('core.translate', 'translate'),
    isVoiceEnabled: true,
  }

  it('speaks the language in the phrases of every locale', () => {
    const routes = compileVoiceRoutes([translate], tools)
    for (const [text, language, expectedText] of [
      ['переведи на немецкий Привет', 'de-DE', 'Привет'],
      ['translate to French Hello', 'fr-FR', 'Hello'],
      ['英語に翻訳してこんにちは', 'en-US', 'こんにちは'],
      ['Переведи на Испанский. Привет, как дела?', 'es', 'Привет, как дела?'],
      ['Переведи на аргентинский испанский Текст', 'es-AR', 'Текст'],
      ['Переведи на европейский испанский Текст', 'es-ES', 'Текст'],
      ['Переведи на German Привет', 'de-DE', 'Привет'],
      ['Переведи на Deutsch Привет', 'de-DE', 'Привет'],
      ['Переведи на Spanish Привет', 'es', 'Привет'],
      ['Переведи на Español Привет', 'es', 'Привет'],
      ['translate to Deutsch Hello', 'de-DE', 'Hello'],
      ['translate into Spanish Hello', 'es', 'Hello'],
      ['перевести на испанский Привет', 'es', 'Привет'],
      ['перевод на испанский Привет', 'es', 'Привет'],
      ['переведи в испанский Привет', 'es', 'Привет'],
    ] as const) {
      const result = resolveVoice(routes, text)
      expect(result.kind).toBe('match')
      expect(result.candidates[0]).toMatchObject({
        commandId: 'translate',
        parameters: { language },
        text: expectedText,
      })
    }
  })

  it('takes the slot of an own phrase, or puts the value after it', () => {
    const own = { ...translate, phrases: ['say it in {language} please', 'in'] }
    const routes = compileVoiceRoutes([own], tools)
    expect(resolveVoice(routes, 'translate to German Hi').kind).toBe('none')
    expect(
      resolveVoice(routes, 'say it in German please Hi').candidates[0]
    ).toMatchObject({ parameters: { language: 'de-DE' }, text: 'Hi' })
    expect(resolveVoice(routes, 'in Spanish Hola').candidates[0]).toMatchObject(
      { parameters: { language: 'es' }, text: 'Hola' }
    )
  })

  it('names no parameter of a command that has a value for it', () => {
    const fixed = {
      ...translate,
      phrases: ['to german'],
      operationConfig: { language: 'de-DE' },
    }
    expect(compileVoiceRoutes([fixed], tools)).toEqual([
      { commandId: 'translate', phrase: 'to german', parameters: [] },
    ])
  })

  it('needs the parameter before the command runs', () => {
    expect(voiceInputIssue(translate, 'Hello', tools)).toBe('missing-parameter')
    expect(
      voiceInputIssue(translate, 'Hello', tools, undefined, {
        language: 'de-DE',
      })
    ).toBeUndefined()
  })

  it('names the parameter whose spoken value is not recognized', () => {
    const result = resolveVoice(
      compileVoiceRoutes([translate], tools),
      'translate to Klingon Hello'
    )
    expect(result).toMatchObject({
      kind: 'parameter-error',
      failedParameter: { commandId: 'translate', name: 'language' },
    })
  })

  it('never takes a regional language for another one', () => {
    const routes = compileVoiceRoutes([translate], tools)
    // `es` is preferred over its regions, see `preferBaseLanguage`
    const regional = ['pt-BR', 'pt-PT', 'en-US', 'en-GB', 'zh-CN', 'zh-TW']
    for (const item of routes) {
      const [parameter] = item.parameters
      if (!parameter || !regional.includes(parameter.value)) continue
      for (const variant of parameter.variants) {
        const spoken = [item.phrase, variant, item.suffix ?? '', 'Hi']
        const result = resolveVoice(routes, spoken.join(' '))
        expect(result.kind, spoken.join(' ')).toBe('match')
        expect(result.candidates[0]!.parameters.language).toBe(parameter.value)
      }
    }
  })
})

describe('generic voice parameters', () => {
  const choice = (value: string, variant: string): VoiceRoute => ({
    commandId: 'pick',
    phrase: 'pick',
    parameters: [
      {
        name: 'size',
        value,
        variants: [variant],
        preferValue: (values) =>
          values.includes('large') ? 'large' : undefined,
      },
    ],
  })

  it('lets the parameter settle a phrase that names several values', () => {
    const routes = [choice('large', 'big'), choice('huge', 'big')]
    expect(resolveVoice(routes, 'pick big now')).toMatchObject({
      kind: 'match',
      candidates: [{ parameters: { size: 'large' }, text: 'now' }],
    })
    const undecided = [choice('small', 'tiny'), choice('mini', 'tiny')]
    expect(resolveVoice(undecided, 'pick tiny now').kind).toBe('ambiguous')
  })

  it('warns about parameters a phrase cannot name', () => {
    const tool = {
      ...testTranslateOperation(),
      id: 'test.dynamic',
      commandParameters: [
        { name: 'board', description: 'Board', getOptions: () => [] },
        { name: 'list', description: 'List', options: [{ value: 'a' }] },
      ],
    }
    const several = testOperations({}, [
      { ...tool, commandParameters: [...tool.commandParameters].reverse() },
    ])
    const command = {
      ...createCommand('test.dynamic', 'dynamic'),
      isVoiceEnabled: true,
    }
    expect(voiceParameterIssue(command, testOperations({}, [tool]))).toBe(
      'unspeakable-parameter'
    )
    expect(voiceParameterIssue(command, several)).toBe('unspoken-parameters')
    expect(
      voiceParameterIssue(
        { ...command, operationConfig: { list: 'a' } },
        several
      )
    ).toBe('unspeakable-parameter')
  })
})

describe('voiceEnabledPatch', () => {
  const tools = testOperations({}, [testTranslateOperation()])
  const note = {
    ...createCommand('script', 'note'),
    name: 'Save note',
    operationConfig: { command: 'echo {{TEXT}}' },
  }

  it('starts with the name as the phrase when there is none', () => {
    expect(voiceEnabledPatch(note, true, tools)).toEqual({
      isVoiceEnabled: true,
      phrases: ['Save note'],
    })
  })

  it('keeps the phrases when turned off and restores them when turned on', () => {
    const withPhrases = { ...note, phrases: ['jot down'] }
    expect(voiceEnabledPatch(withPhrases, false, tools)).toEqual({
      isVoiceEnabled: false,
    })
    expect(voiceEnabledPatch(withPhrases, true, tools)).toEqual({
      isVoiceEnabled: true,
    })
  })

  it('leaves a command with a spoken parameter to the phrases of its tool', () => {
    const translate = {
      ...createCommand('core.translate', 't'),
      name: 'Translate',
    }
    expect(voiceEnabledPatch(translate, true, tools)).toEqual({
      isVoiceEnabled: true,
    })
  })
})
