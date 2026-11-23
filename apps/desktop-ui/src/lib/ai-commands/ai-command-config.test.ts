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
        tools: [
          { sourceKind: 'commands', sourceId: 'commands', toolName: 'a' },
          { sourceKind: 'commands', sourceId: 'commands', toolName: 'a' },
          { sourceKind: 'core', sourceId: 'web' },
          { sourceKind: 'bogus', sourceId: 'x' },
          { sourceKind: 'core', sourceId: ' ' },
          7,
        ],
      })
    ).toEqual({
      prompt: 'Do it',
      tools: [
        { sourceKind: 'commands', sourceId: 'commands', toolName: 'a' },
        { sourceKind: 'core', sourceId: 'web' },
      ],
    })
  })

  it('falls back to the defaults', () => {
    expect(aiCommandOperationConfigOf({})).toEqual({ prompt: '', tools: [] })
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
