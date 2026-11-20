import { describe, expect, it } from 'vitest'

import { createCommand } from '../commands/command-config'
import { commandLabel, validateCommand } from '../commands/command-runtime'
import {
  commandInputSchema,
  openCommandParameters,
  parameterValue,
  withOpenParameters,
} from './command-parameters'
import { TEXT_INPUT_SCHEMA } from './operation-types'
import { testOperations, testTranslateOperation } from './testing'
import { outputRequest } from './operation-call'

const tools = testOperations({}, [
  testTranslateOperation(async (language, text) => `${language}:${text}`),
])
const translateTool = tools.get('core.translate')!

const call = (
  input: Record<string, unknown>,
  config: Record<string, unknown>
) => ({
  input,
  config,
  source: 'menu' as const,
  signal: new AbortController().signal,
  ...outputRequest(true),
})

describe('command parameters', () => {
  it('leaves to the caller only what the command does not set', () => {
    expect(
      openCommandParameters(translateTool, {}).map((item) => item.name)
    ).toEqual(['language'])
    expect(openCommandParameters(translateTool, { language: 'de-DE' })).toEqual(
      []
    )
    expect(openCommandParameters(tools.get('script'), {})).toEqual([])
  })

  it('asks a caller that gives the input whole for the open parameters', () => {
    const open = commandInputSchema(translateTool, {})
    expect(open.required).toEqual(['text', 'language'])
    expect(open.properties?.language?.enum).toContain('de-DE')
    expect(
      commandInputSchema(translateTool, { language: 'de-DE' }).required
    ).toEqual(['text'])
  })

  it('takes the value of the caller over the one of the command', () => {
    expect(
      parameterValue(
        call({ language: 'fr-FR' }, { language: 'de-DE' }),
        'language'
      )
    ).toBe('fr-FR')
    expect(parameterValue(call({}, { language: ' de-DE ' }), 'language')).toBe(
      'de-DE'
    )
    expect(parameterValue(call({}, {}), 'language')).toBe('')
  })

  it('translates into the language of the call', async () => {
    await expect(
      translateTool.run(call({ text: 'Hi', language: 'fr-FR' }, {}))
    ).resolves.toMatchObject({ ok: true, content: 'fr-FR:Hi' })
    await expect(
      translateTool.run(call({ text: 'Hi' }, {}))
    ).resolves.toMatchObject({
      ok: false,
      messageKey: 'commands.errorNoLanguage',
    })
  })

  it('names a command without a name by its core tool, but asks for one', () => {
    const command = createCommand('core.translate', 'translate')
    expect(commandLabel(command)).toBeTruthy()
    expect(commandLabel(command)).not.toBe('core.translate')
    expect(validateCommand(command, tools)).toEqual([
      { field: 'name', messageKey: 'commands.errorNoName' },
    ])
  })

  it('leaves a parameter without a list of values open to any value', () => {
    const schema = withOpenParameters(
      TEXT_INPUT_SCHEMA,
      {
        commandParameters: [
          {
            name: 'folder',
            description: 'A folder',
            getOptions: () => [{ value: 'a' }],
          },
          {
            name: 'mode',
            description: 'A mode',
            options: [{ value: 'fast' }, { value: 'slow' }],
          },
        ],
      },
      {}
    )
    expect(schema.properties?.folder).not.toHaveProperty('enum')
    expect(schema.properties?.mode?.enum).toEqual(['fast', 'slow'])
  })
})
