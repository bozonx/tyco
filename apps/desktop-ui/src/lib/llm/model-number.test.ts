import { describe, expect, it } from 'vitest'

import { parseModelTokenCount, parseModelTemperature } from './model-number'

describe('model numeric settings', () => {
  it('leaves an empty temperature to the model', () => {
    expect(parseModelTemperature('  ')).toEqual({ isValid: true })
  })

  it('takes a temperature between 0 and 2', () => {
    expect(parseModelTemperature('0')).toEqual({ value: 0, isValid: true })
    expect(parseModelTemperature('1.5')).toEqual({ value: 1.5, isValid: true })
    expect(parseModelTemperature('2')).toEqual({ value: 2, isValid: true })
    expect(parseModelTemperature('Infinity').isValid).toBe(false)
    expect(parseModelTemperature('2.1').isValid).toBe(false)
    expect(parseModelTemperature('-1').isValid).toBe(false)
    expect(parseModelTemperature('warm').isValid).toBe(false)
  })

  it('takes a positive whole number of output tokens', () => {
    expect(parseModelTokenCount('')).toEqual({ isValid: true })
    expect(parseModelTokenCount('2048')).toEqual({ value: 2048, isValid: true })
    expect(parseModelTokenCount('9007199254740992').isValid).toBe(false)
    expect(parseModelTokenCount('Infinity').isValid).toBe(false)
    expect(parseModelTokenCount('0').isValid).toBe(false)
    expect(parseModelTokenCount('1.5').isValid).toBe(false)
  })
})
