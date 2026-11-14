import { describe, expect, it } from 'vitest'
import {
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
