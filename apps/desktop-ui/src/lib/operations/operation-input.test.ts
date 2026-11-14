import { describe, expect, it, vi } from 'vitest'

import {
  resolveOperationInput,
  schemaShape,
  operationCallConfig,
  operationInputKind,
  validateOperationInput,
} from './operation-input'
import {
  type JsonSchema,
  NO_INPUT_SCHEMA,
  type RegisteredOperation,
  TEXT_INPUT_SCHEMA,
} from './operation-types'

const REMINDER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    at: { type: 'string' },
    text: { type: 'string' },
    repeat: { type: 'string', enum: ['none', 'daily'] },
  },
  required: ['at', 'text'],
}

const tool = (
  extra: Partial<RegisteredOperation> = {}
): RegisteredOperation => ({
  id: 'Test.tool',
  description: 'A test tool',
  inputSchema: TEXT_INPUT_SCHEMA,
  owner: { kind: 'plugin', pluginId: 'Test' },
  run: vi.fn(async () => ({ ok: true })),
  ...extra,
})

const context = () => ({
  now: new Date(0),
  signal: new AbortController().signal,
})

describe('schemaShape', () => {
  it('tells the empty, the text and the structured inputs apart', () => {
    expect(schemaShape(NO_INPUT_SCHEMA)).toBe('none')
    expect(schemaShape({ type: 'object' })).toBe('none')
    expect(schemaShape(TEXT_INPUT_SCHEMA)).toBe('text')
    expect(
      schemaShape({ type: 'object', properties: { text: { type: 'number' } } })
    ).toBe('structured')
    expect(schemaShape(REMINDER_SCHEMA)).toBe('structured')
  })
})

describe('operationInputKind', () => {
  it('follows the settings when the schema depends on them', () => {
    const scriptLike = tool({
      inputSchemaFor: (config) =>
        config.noInput ? NO_INPUT_SCHEMA : TEXT_INPUT_SCHEMA,
    })
    expect(operationInputKind(scriptLike, {})).toBe('text')
    expect(operationInputKind(scriptLike, { noInput: true })).toBe('none')
  })

  it('needs a parser for a structured input', () => {
    const structured = tool({ inputSchema: REMINDER_SCHEMA })
    expect(operationInputKind(structured, {})).toBeNull()
    expect(operationInputKind(structured, {}, true)).toBe('parsed')
    expect(
      operationInputKind(
        { ...structured, parseText: async () => ({ ok: true, input: {} }) },
        {}
      )
    ).toBe('parsed')
  })
})

describe('operationCallConfig', () => {
  it('lays the command settings over those of the plugin', () => {
    const withBase = tool({
      baseConfig: () => ({ dir: '~/notes', mode: 'create', clear: true }),
    })
    expect(
      operationCallConfig(withBase, { dir: '~/work', mode: '  ', extra: 1 })
    ).toEqual({ dir: '~/work', mode: 'create', clear: true, extra: 1 })
    expect(operationCallConfig(tool(), { mode: '' })).toEqual({ mode: '' })
  })
})

describe('validateOperationInput', () => {
  it('checks required properties, types and enums', () => {
    expect(
      validateOperationInput(REMINDER_SCHEMA, { at: '15:40', text: 'call' })
    ).toEqual([])
    expect(
      validateOperationInput(REMINDER_SCHEMA, { at: 1540, repeat: 'weekly' })
    ).toEqual([
      'Missing `text`',
      '`at` must be string',
      '`repeat` has a value not allowed',
    ])
  })
})

describe('resolveOperationInput', () => {
  it('gives nothing or the text as it is', async () => {
    expect(
      await resolveOperationInput({
        tool: tool({ inputSchema: NO_INPUT_SCHEMA }),
        config: {},
        text: 'ignored',
        context: context(),
      })
    ).toEqual({ ok: true, input: {} })
    expect(
      await resolveOperationInput({
        tool: tool(),
        config: {},
        text: ' as is ',
        context: context(),
      })
    ).toEqual({ ok: true, input: { text: ' as is ' } })
  })

  it('lets the tool parse the text with its settings', async () => {
    const parseText = vi.fn(async () => ({
      ok: true as const,
      input: { at: '15:40', text: 'call mom' },
      summary: 'At 15:40: call mom',
    }))
    const result = await resolveOperationInput({
      tool: tool({ inputSchema: REMINDER_SCHEMA, parseText }),
      config: { zone: 'UTC' },
      text: 'in an hour call mom',
      context: context(),
    })
    expect(result).toEqual({
      ok: true,
      input: { at: '15:40', text: 'call mom' },
      summary: 'At 15:40: call mom',
    })
    expect(parseText).toHaveBeenCalledWith(
      'in an hour call mom',
      expect.objectContaining({ config: { zone: 'UTC' } })
    )
  })

  it('passes on a parse failure and rejects an input off the schema', async () => {
    expect(
      await resolveOperationInput({
        tool: tool({
          inputSchema: REMINDER_SCHEMA,
          parseText: async () => ({ ok: false, messageKey: 'no.time' }),
        }),
        config: {},
        text: 'x',
        context: context(),
      })
    ).toEqual({ ok: false, messageKey: 'no.time' })
    expect(
      await resolveOperationInput({
        tool: tool({
          inputSchema: REMINDER_SCHEMA,
          parseText: async () => ({ ok: true, input: { text: 'x' } }),
        }),
        config: {},
        text: 'x',
        context: context(),
      })
    ).toEqual({
      ok: false,
      messageKey: 'toast.commandInputInvalid',
      message: 'Missing `at`',
    })
  })

  it('fills a structured input with the LLM only when asked and possible', async () => {
    const extract = vi.fn(async () => ({ at: '9:00', text: 'bank' }))
    const structured = tool({ inputSchema: REMINDER_SCHEMA })
    expect(
      await resolveOperationInput({
        tool: structured,
        config: {},
        text: 'x',
        isLlmArgumentParsingEnabled: true,
        context: { ...context(), llm: { extract } },
      })
    ).toEqual({ ok: true, input: { at: '9:00', text: 'bank' } })
    expect(
      await resolveOperationInput({
        tool: structured,
        config: {},
        text: 'x',
        isLlmArgumentParsingEnabled: true,
        context: context(),
      })
    ).toEqual({ ok: false, messageKey: 'toast.commandInputUnsupported' })
  })
})

describe('command preset inheritance', () => {
  it('applies a command preset over plugin settings and then explicit overrides', () => {
    const notes = tool({
      baseConfig: () => ({
        preset: 'default',
        pathToNotes: '/notes',
        saveMode: 'create',
        fileNameTemplate: 'new.md',
      }),
      configPresets: {
        preset: {
          daily: { saveMode: 'append', fileNameTemplate: 'daily.md' },
          custom: {},
        },
      },
    })
    expect(operationCallConfig(notes, { preset: 'daily' })).toMatchObject({
      pathToNotes: '/notes',
      saveMode: 'append',
      fileNameTemplate: 'daily.md',
    })
    expect(
      operationCallConfig(notes, {
        preset: 'daily',
        fileNameTemplate: 'other.md',
      })
    ).toMatchObject({ saveMode: 'append', fileNameTemplate: 'other.md' })
    expect(operationCallConfig(notes, { preset: 'custom' }).saveMode).toBe(
      'create'
    )
  })
})
