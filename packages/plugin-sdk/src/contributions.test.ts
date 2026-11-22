import { describe, expect, it } from 'vitest'
import {
  validateChatToolContribution,
  cancelledOperationResult,
  validateContribution,
  validateParseResult,
  validateOperationConfigPreview,
  validateOperationResult,
  validateOperationSchema,
} from './contributions.js'

describe('plugin contribution validation', () => {
  it('requires an exclusive callback or local tool reference for toolbar and action items', () => {
    expect(() =>
      validateContribution({ id: 'button', operationId: 'search' }, 'toolbar')
    ).not.toThrow()
    expect(() =>
      validateContribution({ id: 'action', operationId: 'search' }, 'action')
    ).not.toThrow()
    expect(() =>
      validateContribution(
        { id: 'button', operationId: 'search', action: () => {} },
        'toolbar'
      )
    ).toThrow()
    expect(() =>
      validateContribution(
        { id: 'action', operationId: 'search', action: () => {} },
        'action'
      )
    ).toThrow()
    expect(() =>
      validateContribution(
        { id: 'button', operationId: 'Other.search' },
        'toolbar'
      )
    ).toThrow()
    expect(() =>
      validateContribution({ id: 'edit', operationId: 'search' }, 'edit')
    ).toThrow()
    expect(() => validateContribution({ id: 'button' }, 'toolbar')).toThrow()
    expect(() =>
      validateContribution(
        { id: 'localTool', canSelectPlatforms: true },
        'tool'
      )
    ).not.toThrow()
    expect(() =>
      validateContribution(
        { id: 'localTool', canSelectPlatforms: 'linux' },
        'tool'
      )
    ).toThrow()
  })
  it.each([
    null,
    {},
    { ok: 'yes' },
    { ok: true, content: {} },
    { ok: false, cancelled: 'yes' },
    { ok: true, level: 'invalid' },
  ])('rejects malformed tool results: %j', (value) => {
    expect(() => validateOperationResult(value)).toThrow()
  })
  it('validates parsed values and nested schemas', () => {
    expect(() => validateParseResult({ ok: true, input: [] })).toThrow()
    expect(() => validateParseResult({ ok: false, message: 3 })).toThrow()
    expect(() =>
      validateOperationSchema({
        type: 'object',
        properties: { entries: { type: 'array', items: { type: 'string' } } },
      })
    ).not.toThrow()
    expect(() =>
      validateOperationSchema({ properties: { broken: null } })
    ).toThrow()
    expect(() => validateOperationSchema({ required: 'text' })).toThrow()
  })
  it('reports a cancelled run only when it already committed a change', () => {
    expect(cancelledOperationResult({ ok: true, content: 'text' })).toEqual({
      ok: false,
      cancelled: true,
    })
    expect(
      cancelledOperationResult({
        ok: true,
        isCommitted: true,
        content: 'text',
        messageKey: 'local.saved',
      })
    ).toEqual({ ok: true, isCommitted: true, messageKey: 'local.saved' })
    expect(cancelledOperationResult({ ok: false, isCommitted: true })).toEqual({
      ok: false,
      cancelled: true,
    })
    expect(() =>
      cancelledOperationResult({ ok: true, isCommitted: true, level: 'loud' })
    ).toThrow()
  })
  it('bounds settings previews', () => {
    expect(() =>
      validateOperationConfigPreview({
        issues: [{ messageKey: 'local.bad', params: { token: 'x', count: 1 } }],
        samples: ['a', 'b'],
      })
    ).not.toThrow()
    for (const value of [
      null,
      { issues: [{}] },
      { issues: [{ messageKey: 'k', params: { nested: {} } }] },
      { samples: [1] },
      { samples: Array(9).fill('') },
      { samples: ['x'.repeat(65_537)] },
    ])
      expect(() => validateOperationConfigPreview(value)).toThrow()
  })
})

describe('validateChatToolContribution', () => {
  const tool = {
    id: 'count',
    labelKey: 'count',
    description: 'Counts words',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    risk: 'read',
    run: () => ({ ok: true }),
  }

  it('accepts a described tool with a risk and a callback', () => {
    expect(() => validateChatToolContribution(tool, [])).not.toThrow()
  })

  it('refuses a tool without a description, risk or callback', () => {
    expect(() =>
      validateChatToolContribution({ ...tool, description: ' ' }, [])
    ).toThrow()
    expect(() =>
      validateChatToolContribution({ ...tool, risk: 'none' }, [])
    ).toThrow()
    expect(() =>
      validateChatToolContribution({ ...tool, run: undefined }, [])
    ).toThrow()
  })

  it('makes a plugin that reaches past the app declare the external risk', () => {
    expect(() => validateChatToolContribution(tool, ['notes'])).toThrow(
      /external/
    )
    expect(() => validateChatToolContribution(tool, ['browser'])).toThrow()
    expect(() =>
      validateChatToolContribution({ ...tool, risk: 'external' }, ['notes'])
    ).not.toThrow()
  })

  it('makes a plugin with the editor declare at least the write risk', () => {
    expect(() => validateChatToolContribution(tool, ['editor'])).toThrow(
      /write/
    )
    expect(() =>
      validateChatToolContribution({ ...tool, risk: 'write' }, ['editor'])
    ).not.toThrow()
  })
})
