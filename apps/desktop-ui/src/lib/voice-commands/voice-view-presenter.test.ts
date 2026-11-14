import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../commands/command-config'
import { testOperations, testTranslateOperation } from '../operations/testing'
import {
  pickVoiceCommand,
  resolveVoiceNotice,
  voiceCommandPhrases,
  voiceParameterLabels,
  voiceParameterOptions,
  voiceParameters,
} from './voice-view-presenter'

const t = (key: string, params?: Record<string, string>) =>
  key === 'voiceGrammar.translate'
    ? `translate to {language};into {language}`
    : params
      ? `${key}:${JSON.stringify(params)}`
      : key
const tools = testOperations({}, [testTranslateOperation()])

describe('voice-view-presenter', () => {
  it('shows the phrases of a command as they are', () => {
    const command = {
      ...createCommand('script', 'custom-1'),
      phrases: ['deploy now', ' ', 'deploy now'],
    }
    expect(voiceParameters(command, tools)).toEqual([])
    expect(voiceCommandPhrases(command, tools, t)).toEqual(['deploy now'])
  })

  it('shows the first phrase of the tool with the parameter it names', () => {
    const command = createCommand('core.translate', 'translate')
    expect(voiceParameters(command, tools).map((item) => item.name)).toEqual([
      'language',
    ])
    expect(voiceCommandPhrases(command, tools, t)).toEqual([
      'translate to voiceCommands.languagePlaceholder voiceCommands.textPlaceholder',
    ])
    const own = { ...command, phrases: ['render as'] }
    expect(voiceCommandPhrases(own, tools, t)).toEqual([
      'render as voiceCommands.languagePlaceholder voiceCommands.textPlaceholder',
    ])
  })

  it('names the values of a parameter and leaves a fixed one out', () => {
    const command = createCommand('core.translate', 'translate')
    const [parameter] = voiceParameters(command, tools)
    expect(voiceParameterOptions(parameter!, t)).toContainEqual({
      id: 'de-DE',
      name: 'language.de-DE',
    })
    expect(
      voiceParameterLabels(command, { language: 'de-DE' }, tools, t)
    ).toEqual(['language.de-DE'])
    const fixed = { ...command, operationConfig: { language: 'de-DE' } }
    expect(voiceParameters(fixed, tools)).toEqual([])
  })

  it('resolves notices by priority: error, command issue, or review resolution', () => {
    const cmd = createCommand('script', 'cmd-1')
    expect(
      resolveVoiceNotice(
        {
          error: 'voiceCommands.failed',
          command: cmd,
          unavailableReason: () => undefined,
          inputIssue: undefined,
          stage: 'review',
          resolutionKind: 'match',
        },
        t
      )
    ).toEqual({ kind: 'error', message: 'voiceCommands.failed' })

    expect(
      resolveVoiceNotice(
        {
          error: '',
          command: cmd,
          unavailableReason: () => undefined,
          inputIssue: 'missing-text',
          stage: 'review',
          resolutionKind: 'match',
        },
        t
      )
    ).toEqual({ kind: 'warning', message: 'voiceCommands.missingText' })

    expect(
      resolveVoiceNotice(
        {
          error: '',
          command: undefined,
          unavailableReason: () => undefined,
          inputIssue: undefined,
          stage: 'review',
          resolutionKind: 'ambiguous',
        },
        t
      )
    ).toEqual({ kind: 'info', message: 'voiceCommands.ambiguous' })

    expect(
      resolveVoiceNotice(
        {
          error: '',
          command: cmd,
          unavailableReason: () => undefined,
          inputIssue: 'missing-parameter',
          stage: 'review',
          resolutionKind: 'match',
        },
        t
      )
    ).toEqual({ kind: 'warning', message: 'voiceCommands.parameterMissing' })
  })

  it('picks marked candidate when available or falls back to command id', () => {
    const cmd = createCommand('script', 'cmd-1')
    const candidate = {
      commandId: 'cmd-1',
      text: 'hello',
      parameters: {},
      consumedWordCount: 1,
      textOffset: 0,
      commandOffset: 0,
    }
    const choose = vi.fn()
    const chooseCommand = vi.fn()

    expect(
      pickVoiceCommand(cmd, {
        canPick: () => true,
        marks: new Map([['cmd-1', candidate]]),
        selected: undefined,
        choose,
        chooseCommand,
      })
    ).toBe(true)
    expect(choose).toHaveBeenCalledWith(candidate)
    expect(chooseCommand).not.toHaveBeenCalled()

    expect(
      pickVoiceCommand(cmd, {
        canPick: () => true,
        marks: new Map(),
        selected: undefined,
        choose,
        chooseCommand,
      })
    ).toBe(true)
    expect(chooseCommand).toHaveBeenCalledWith('cmd-1')
  })
})
