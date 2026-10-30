import { describe, expect, it } from 'vitest'
import {
  validateContribution,
  validateParseResult,
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
})
