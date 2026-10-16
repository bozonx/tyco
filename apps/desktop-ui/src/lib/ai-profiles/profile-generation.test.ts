import { describe, expect, it } from 'vitest'

import {
  parseProfileMaxOutputTokens,
  parseProfileTemperature,
} from './profile-generation'

describe('profile generation settings', () => {
  it('leaves an empty temperature to the model', () => {
    expect(parseProfileTemperature('  ')).toEqual({ isValid: true })
  })

  it('takes a temperature between 0 and 2', () => {
    expect(parseProfileTemperature('0')).toEqual({ value: 0, isValid: true })
    expect(parseProfileTemperature('1.5')).toEqual({
      value: 1.5,
      isValid: true,
    })
    expect(parseProfileTemperature('2.1').isValid).toBe(false)
    expect(parseProfileTemperature('-1').isValid).toBe(false)
    expect(parseProfileTemperature('warm').isValid).toBe(false)
  })

  it('takes a positive whole number of output tokens', () => {
    expect(parseProfileMaxOutputTokens('')).toEqual({ isValid: true })
    expect(parseProfileMaxOutputTokens('2048')).toEqual({
      value: 2048,
      isValid: true,
    })
    expect(parseProfileMaxOutputTokens('0').isValid).toBe(false)
    expect(parseProfileMaxOutputTokens('1.5').isValid).toBe(false)
  })
})
