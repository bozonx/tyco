import { describe, expect, it, vi } from 'vitest'
import {
  assertPluginMessage,
  decodePluginValue,
  encodePluginValue,
  PLUGIN_RPC_LIMITS,
} from './runtime-protocol.js'

describe('plugin wire values', () => {
  it('round-trips dates, callback references and ordinary marker-like objects', () => {
    const callback = vi.fn()
    const input = {
      now: new Date('2026-01-01T00:00:00Z'),
      run: callback,
      marker: { $callback: 1, label: 'data' },
      nullable: null,
      literalCallback: { $callback: 1 },
      literalDate: { $date: 'ordinary data' },
      literalObject: { $object: [['key', 'data']] },
    }
    const encoded = encodePluginValue(input, () => 1)
    const decoded = decodePluginValue(encoded, () => callback)
    expect(decoded).toEqual(input)
  })
  it('rejects oversized, cyclic, deep and non-finite values', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deep: unknown = {}
    for (let i = 0; i < 40; i++) deep = { nested: deep }
    for (const invalid of [
      cyclic,
      deep,
      Infinity,
      'x'.repeat(PLUGIN_RPC_LIMITS.messageBytes + 1),
    ]) {
      expect(() => assertPluginMessage(invalid)).toThrow()
    }
  })
})

it('rejects malformed reserved wire markers without resolving callbacks', () => {
  const callback = vi.fn()
  for (const value of [
    { $object: false },
    { $object: [[1, 'value']] },
    { $callback: -1 },
    { $callback: '1' },
    { $date: 123 },
    { $date: 'invalid' },
  ]) {
    expect(() => decodePluginValue(value, callback)).toThrow()
  }
  expect(callback).not.toHaveBeenCalled()
})
