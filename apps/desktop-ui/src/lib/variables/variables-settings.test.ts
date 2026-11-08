import { describe, expect, it } from 'vitest'
import { DEFAULT_USER_CONFIG, normalizeUserConfig } from '@tyco/shared'

import {
  addVariable,
  newVariableId,
  removeVariable,
  renameVariableIn,
  setVariableValue,
  unsetVariables,
  variableReferenceIssues,
} from './variables-settings'
import {
  commandMissingVariables,
  renameVariable,
  variableUsage,
  withProviderVariables,
} from './command-variables'

const config = () =>
  normalizeUserConfig({
    ...DEFAULT_USER_CONFIG,
    variables: [{ id: 'notes', name: 'NOTES_DIR', description: '' }],
    variableValues: { notes: '/n' },
    commands: [
      {
        id: 'save',
        name: 'Save',
        toolId: 'script',
        toolConfig: {
          command: 'cp x {{var:NOTES_DIR}}',
          workingDirectory: '{{var:NOTES_DIR}}',
        },
      },
      {
        id: 'hook',
        name: 'Hook',
        toolId: 'webhook',
        toolConfig: {
          url: 'https://x.test/{{var:NOTES_DIR}}',
          method: 'GET',
          payloadTemplate: '{{var:OTHER}}',
          headers: {
            'X-A': '{{var:NOTES_DIR}}',
            'X-B': 'tyco-secret:webhook.header.1',
          },
        },
      },
      {
        id: 'ask',
        name: 'Ask',
        toolId: 'core.aiTask',
        toolConfig: { prompt: 'Look in {{var:NOTES_DIR}}' },
      },
      {
        id: 'note',
        name: 'Note',
        toolId: 'FastNote.addNote',
        toolConfig: { title: '{{var:NOTES_DIR}}' },
      },
    ],
    llm: {
      ...DEFAULT_USER_CONFIG.llm,
      providers: [
        ...DEFAULT_USER_CONFIG.llm.providers,
        {
          id: 'local',
          type: 'openaiCompatible',
          baseUrl: '{{var:NOTES_DIR}}/v1',
        },
      ],
    },
  })

describe('variables settings', () => {
  it('declares a variable with a stable id and refuses a bad name', () => {
    const draft = config()
    expect(addVariable(draft, ' LOCAL_API ', 'Local API')).toMatchObject({
      ok: true,
      variable: { id: 'local_api', name: 'LOCAL_API' },
    })
    expect(addVariable(draft, 'notes_dir')).toEqual({
      ok: false,
      issueKey: 'variables.errorInvalidName',
    })
    expect(addVariable(draft, 'TYCO_HOME')).toEqual({
      ok: false,
      issueKey: 'variables.errorBuiltinName',
    })
    expect(addVariable(draft, 'NOTES_DIR')).toEqual({
      ok: false,
      issueKey: 'variables.errorNameTaken',
    })
    expect(newVariableId('A', ['a', 'a-2'])).toBe('a-3')
  })

  it('sets the value on this device when a variable is declared with one', () => {
    const draft = config()
    const result = addVariable(draft, 'LOCAL_API', '', 'http://localhost')
    expect(result.ok && draft.variableValues[result.variable.id]).toBe(
      'http://localhost'
    )
    const blank = addVariable(draft, 'EMPTY', '', '  ')
    expect(blank.ok && blank.variable.id in draft.variableValues).toBe(false)
  })

  it('tells what each reference of a template lacks', () => {
    const draft = config()
    addVariable(draft, 'SET_VAR', '', 'value')
    addVariable(draft, 'UNSET_VAR')
    const unsetId = draft.variables.find((v) => v.name === 'UNSET_VAR')!.id
    expect(
      variableReferenceIssues(
        [
          '{{var:SET_VAR}} {{var:UNSET_VAR}} {{var:TYCO_USER_DIR}}',
          '{{var:NEW_VAR}} {{var:lower}} {{var:unset_var}} {{var:UNSET_VAR}}',
        ],
        draft
      )
    ).toEqual([
      { kind: 'notSet', name: 'UNSET_VAR', variableId: unsetId },
      { kind: 'notDeclared', name: 'NEW_VAR' },
      { kind: 'invalidName', name: 'lower' },
      { kind: 'wrongCase', name: 'unset_var', expected: 'UNSET_VAR' },
    ])
  })

  it('renames the references of the commands and providers that fill them', () => {
    const draft = config()
    expect(renameVariableIn(draft, 'notes', 'NOTES')).toBeUndefined()
    const [save, hook, ask, note] = draft.commands
    expect(save!.toolConfig).toEqual({
      command: 'cp x {{var:NOTES}}',
      workingDirectory: '{{var:NOTES}}',
    })
    expect(hook!.toolConfig.url).toBe('https://x.test/{{var:NOTES}}')
    expect(hook!.toolConfig.headers).toEqual({
      'X-A': '{{var:NOTES}}',
      'X-B': 'tyco-secret:webhook.header.1',
    })
    expect(ask!.toolConfig.prompt).toBe('Look in {{var:NOTES}}')
    // a plugin field has its own templates
    expect(note!.toolConfig.title).toBe('{{var:NOTES_DIR}}')
    expect(draft.llm.providers.at(-1)!.baseUrl).toBe('{{var:NOTES}}/v1')
    expect(draft.variables[0]!.name).toBe('NOTES')
    expect(renameVariableIn(draft, 'notes', 'bad name')).toBe(
      'variables.errorInvalidName'
    )
  })

  it('keeps a value on this device and drops it with its variable', () => {
    const draft = config()
    setVariableValue(draft, 'notes', '  ')
    expect(draft.variableValues).toEqual({})
    expect(unsetVariables(draft).map((variable) => variable.name)).toEqual([
      'NOTES_DIR',
    ])
    setVariableValue(draft, 'notes', '/m')
    expect(unsetVariables(draft)).toEqual([])
    removeVariable(draft, 'notes')
    expect(draft.variables).toEqual([])
    expect(draft.variableValues).toEqual({})
  })

  it('tells which commands and providers use a variable and which are unset', () => {
    const draft = config()
    expect(variableUsage(draft, 'NOTES_DIR')).toEqual({
      commandIds: ['save', 'hook', 'ask'],
      providerIds: ['local'],
    })
    // the body of a GET request is not sent
    expect(commandMissingVariables(draft.commands[1]!, {})).toEqual([
      'NOTES_DIR',
    ])
    expect(
      commandMissingVariables(
        {
          ...draft.commands[1]!,
          toolConfig: { ...draft.commands[1]!.toolConfig, method: 'POST' },
        },
        { NOTES_DIR: '/n' }
      )
    ).toEqual(['OTHER'])
  })

  it('gives a provider the base URL of this device, or none', () => {
    const draft = config()
    const local = (variables: Record<string, string>) =>
      withProviderVariables(draft.llm, variables).providers.at(-1)!.baseUrl
    expect(local({ NOTES_DIR: 'http://localhost:11434' })).toBe(
      'http://localhost:11434/v1'
    )
    expect(local({})).toBe('')
    expect(renameVariable(draft, 'missing', 'X').commands).toBe(draft.commands)
  })
})
