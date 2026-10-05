import { describe, expect, it, vi } from 'vitest'

import {
  resolveToolInput,
  schemaShape,
  toolCallConfig,
  toolInputKind,
  validateToolInput,
} from './tool-input'
import {
  type JsonSchema,
  NO_INPUT_SCHEMA,
  type RegisteredTool,
  TEXT_INPUT_SCHEMA,
} from './tool-types'

const REMINDER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    at: { type: 'string' },
    text: { type: 'string' },
    repeat: { type: 'string', enum: ['none', 'daily'] },
  },
  required: ['at', 'text'],
}

const tool = (extra: Partial<RegisteredTool> = {}): RegisteredTool => ({
  id: 'Test.tool',
  description: 'A test tool',
  inputSchema: TEXT_INPUT_SCHEMA,
  owner: { kind: 'plugin', name: 'Test' },
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

describe('toolInputKind', () => {
  it('follows the settings when the schema depends on them', () => {
    const scriptLike = tool({
      inputSchemaFor: (config) =>
        config.takesText === false ? NO_INPUT_SCHEMA : TEXT_INPUT_SCHEMA,
    })
    expect(toolInputKind(scriptLike, {})).toBe('text')
    expect(toolInputKind(scriptLike, { takesText: false })).toBe('none')
  })

  it('needs a parser for a structured input', () => {
    const structured = tool({ inputSchema: REMINDER_SCHEMA })
    expect(toolInputKind(structured, {})).toBeNull()
    expect(toolInputKind(structured, {}, true)).toBe('parsed')
    expect(
      toolInputKind(
        { ...structured, parseText: async () => ({ ok: true, input: {} }) },
        {}
      )
    ).toBe('parsed')
  })
})

describe('toolCallConfig', () => {
  it('lays the command settings over those of the plugin', () => {
    const withBase = tool({
      baseConfig: () => ({ dir: '~/notes', mode: 'create', clear: true }),
    })
    expect(
      toolCallConfig(withBase, { dir: '~/work', mode: '  ', extra: 1 })
    ).toEqual({ dir: '~/work', mode: 'create', clear: true, extra: 1 })
    expect(toolCallConfig(tool(), { mode: '' })).toEqual({ mode: '' })
  })
})

describe('validateToolInput', () => {
  it('checks required properties, types and enums', () => {
    expect(
      validateToolInput(REMINDER_SCHEMA, { at: '15:40', text: 'call' })
    ).toEqual([])
    expect(
      validateToolInput(REMINDER_SCHEMA, { at: 1540, repeat: 'weekly' })
    ).toEqual([
      'Missing `text`',
      '`at` must be string',
      '`repeat` has a value not allowed',
    ])
  })
})

describe('resolveToolInput', () => {
  it('gives nothing or the text as it is', async () => {
    expect(
      await resolveToolInput({
        tool: tool({ inputSchema: NO_INPUT_SCHEMA }),
        config: {},
        text: 'ignored',
        context: context(),
      })
    ).toEqual({ ok: true, input: {} })
    expect(
      await resolveToolInput({
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
    const result = await resolveToolInput({
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
      await resolveToolInput({
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
      await resolveToolInput({
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
      await resolveToolInput({
        tool: structured,
        config: {},
        text: 'x',
        llmArgumentParsing: true,
        context: { ...context(), llm: { extract } },
      })
    ).toEqual({ ok: true, input: { at: '9:00', text: 'bank' } })
    expect(
      await resolveToolInput({
        tool: structured,
        config: {},
        text: 'x',
        llmArgumentParsing: true,
        context: context(),
      })
    ).toEqual({ ok: false, messageKey: 'toast.commandInputUnsupported' })
  })
})
