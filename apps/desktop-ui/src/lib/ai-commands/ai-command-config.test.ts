import { describe, expect, it } from 'vitest'

import { createCommand } from '../commands/command-config'
import {
  aiCommandOperationConfigOf,
  callableCommands,
  maxStepsOf,
} from './ai-command-config'

describe('aiCommandOperationConfigOf', () => {
  it('reads the settings, dropping what is not an id', () => {
    expect(
      aiCommandOperationConfigOf({
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

  it('falls back to the defaults, leaving the step limit to the LLM settings', () => {
    expect(aiCommandOperationConfigOf({})).toEqual({
      prompt: '',
      allowedCommandIds: [],
      isToolsEnabled: true,
    })
  })
})

describe('maxStepsOf', () => {
  it('keeps the limit within range and drops what is not one', () => {
    expect(maxStepsOf(2.4)).toBe(2)
    expect(maxStepsOf(500)).toBe(50)
    expect(maxStepsOf(0)).toBeUndefined()
    expect(maxStepsOf('7')).toBeUndefined()
    expect(maxStepsOf(undefined)).toBeUndefined()
  })
})

describe('callableCommands', () => {
  it('offers every command but the AI command itself', () => {
    const self = createCommand('core.aiTask', 'self')
    const other = createCommand('script', 'other')
    expect(callableCommands(self, [self, other])).toEqual([other])
  })
})
