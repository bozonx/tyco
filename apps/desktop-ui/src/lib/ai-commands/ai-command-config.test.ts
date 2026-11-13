import { describe, expect, it } from 'vitest'

import { createCommand } from '../commands/command-config'
import {
  aiCommandToolConfigOf,
  callableCommands,
  maxStepsOf,
} from './ai-command-config'

describe('aiCommandToolConfigOf', () => {
  it('reads the settings, dropping what is not an id', () => {
    expect(
      aiCommandToolConfigOf({
        prompt: 'Do it',
        allowedCommandIds: ['a', 'a', ' ', 7, 'b'],
        maxSteps: 3,
        isToolsEnabled: false,
      })
    ).toEqual({
      prompt: 'Do it',
      allowedCommandIds: ['a', 'b'],
      maxSteps: 3,
      isToolsEnabled: false,
    })
  })

  it('falls back to the defaults', () => {
    expect(aiCommandToolConfigOf({})).toEqual({
      prompt: '',
      allowedCommandIds: [],
      maxSteps: 5,
      isToolsEnabled: true,
    })
  })
})

describe('maxStepsOf', () => {
  it('keeps the limit within range', () => {
    expect(maxStepsOf(2.4)).toBe(2)
    expect(maxStepsOf(500)).toBe(50)
    expect(maxStepsOf(0)).toBe(5)
    expect(maxStepsOf('7')).toBe(5)
  })
})

describe('callableCommands', () => {
  it('offers every command but the AI command itself', () => {
    const self = createCommand('core.aiTask', 'self')
    const other = createCommand('script', 'other')
    expect(callableCommands(self, [self, other])).toEqual([other])
  })
})
