import { describe, expect, it } from 'vitest'
import { createCommand } from '../commands/command-config'
import { testOperations, testTranslateOperation } from '../operations/testing'
import {
  runsOnSelection,
  voiceRunText,
  voiceSelectionUse,
} from './voice-selection'

describe('voice selection', () => {
  const tools = testOperations({}, [testTranslateOperation()])

  it('tells how each kind of command uses the selection', () => {
    expect(voiceSelectionUse(createCommand('core.translate', 't'), tools)).toBe(
      'text'
    )
    expect(
      voiceSelectionUse(
        {
          ...createCommand('script', 's'),
          operationConfig: { command: 'echo {{SELECTION}} {{TEXT}}' },
        },
        tools
      )
    ).toBe('context')
    expect(
      voiceSelectionUse(
        {
          ...createCommand('script', 's'),
          operationConfig: { command: 'echo {{TEXT}}' },
        },
        tools
      )
    ).toBe('none')
  })

  it('runs on the selection, puts spoken words after it, or keeps them', () => {
    expect(voiceRunText('text', 'ignored', 'Sel')).toBe('Sel')
    expect(voiceRunText('attach', 'what is it?', 'Sel')).toBe(
      'Sel\n\nwhat is it?'
    )
    expect(voiceRunText('attach', '', 'Sel')).toBe('Sel')
    expect(voiceRunText('text', 'spoken', '  ')).toBe('spoken')
    expect(voiceRunText('none', 'spoken', 'Sel')).toBe('spoken')
    expect(voiceRunText('context', 'spoken', 'Sel')).toBe('spoken')
  })

  it('needs no spoken text only for a command that runs on the selection', () => {
    expect(runsOnSelection('text', 'Sel')).toBe(true)
    expect(runsOnSelection('text', undefined)).toBe(false)
    expect(runsOnSelection('attach', 'Sel')).toBe(false)
  })
})
