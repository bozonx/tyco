import { describe, expect, it } from 'vitest'
import {
  cancelledToolResult,
  validateContribution,
  validateParseResult,
  validateToolConfigPreview,
  validateToolResult,
  validateToolSchema,
} from './contributions.js'

describe('plugin contribution validation', () => {
  it('requires an exclusive callback or local tool reference for toolbar and action items', () => {
    expect(() =>
      validateContribution({ id: 'button', toolId: 'search' }, 'toolbar')
    ).not.toThrow()
    expect(() =>
      validateContribution({ id: 'action', toolId: 'search' }, 'action')
    ).not.toThrow()
    expect(() =>
      validateContribution(
        { id: 'button', toolId: 'search', action: () => {} },
        'toolbar'
      )
    ).toThrow()
    expect(() =>
      validateContribution(
        { id: 'action', toolId: 'search', action: () => {} },
        'action'
      )
    ).toThrow()
    expect(() =>
      validateContribution({ id: 'button', toolId: 'Other.search' }, 'toolbar')
    ).toThrow()
    expect(() =>
      validateContribution({ id: 'edit', toolId: 'search' }, 'edit')
    ).toThrow()
    expect(() => validateContribution({ id: 'button' }, 'toolbar')).toThrow()
  })
  it.each([
    null,
    {},
    { ok: 'yes' },
    { ok: true, content: {} },
    { ok: false, cancelled: 'yes' },
    { ok: true, level: 'invalid' },
  ])('rejects malformed tool results: %j', (value) => {
    expect(() => validateToolResult(value)).toThrow()
  })
  it('validates parsed values and nested schemas', () => {
    expect(() => validateParseResult({ ok: true, input: [] })).toThrow()
    expect(() => validateParseResult({ ok: false, message: 3 })).toThrow()
    expect(() =>
      validateToolSchema({
        type: 'object',
        properties: { entries: { type: 'array', items: { type: 'string' } } },
      })
    ).not.toThrow()
    expect(() => validateToolSchema({ properties: { broken: null } })).toThrow()
    expect(() => validateToolSchema({ required: 'text' })).toThrow()
  })
  it('reports a cancelled run only when it already committed a change', () => {
    expect(cancelledToolResult({ ok: true, content: 'text' })).toEqual({
      ok: false,
      cancelled: true,
    })
    expect(
      cancelledToolResult({
        ok: true,
        isCommitted: true,
        content: 'text',
        messageKey: 'local.saved',
      })
    ).toEqual({ ok: true, isCommitted: true, messageKey: 'local.saved' })
    expect(cancelledToolResult({ ok: false, isCommitted: true })).toEqual({
      ok: false,
      cancelled: true,
    })
    expect(() =>
      cancelledToolResult({ ok: true, isCommitted: true, level: 'loud' })
    ).toThrow()
  })
  it('bounds settings previews', () => {
    expect(() =>
      validateToolConfigPreview({
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
      expect(() => validateToolConfigPreview(value)).toThrow()
  })
})
