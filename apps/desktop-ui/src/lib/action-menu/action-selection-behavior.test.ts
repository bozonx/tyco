import { describe, expect, it } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { testTools } from '../tools/testing'
import { resolveActionSelectionBehavior } from './action-selection-behavior'

describe('resolveActionSelectionBehavior', () => {
  it('locks to true when action is not set', () => {
    expect(resolveActionSelectionBehavior(null)).toEqual({
      disabled: true,
      forcedValue: true,
    })
    expect(resolveActionSelectionBehavior(undefined)).toEqual({
      disabled: true,
      forcedValue: true,
    })
  })

  it('locks to true for text-bound actions (translation, transformation, styling)', () => {
    expect(
      resolveActionSelectionBehavior({
        type: 'translation',
        language: 'es',
      })
    ).toEqual({ disabled: true, forcedValue: true })

    expect(
      resolveActionSelectionBehavior({
        type: 'transformation',
        transformationId: 'deep-edit',
      })
    ).toEqual({ disabled: true, forcedValue: true })

    expect(
      resolveActionSelectionBehavior({
        type: 'styling',
        stylingId: 'bold',
      })
    ).toEqual({ disabled: true, forcedValue: true })
  })

  it('locks to true for standard actions that require text', () => {
    for (const actionId of [
      'correction',
      'directCorrection',
      'translationMenu',
      'transformationMenu',
      'stylingMenu',
      'insertIntoWindow',
      'copyToClipboard',
    ] as const) {
      expect(
        resolveActionSelectionBehavior({ type: 'standard', actionId })
      ).toEqual({ disabled: true, forcedValue: true })
    }
  })

  it('locks to false for standard actions that do not accept text selection', () => {
    for (const actionId of [
      'screenshotQuickAiRequest',
      'voiceScreenshotQuickAiRequest',
      'voiceCommands',
      'favoritesMenu',
      'openHistory',
      'voiceInput',
    ] as const) {
      expect(
        resolveActionSelectionBehavior({ type: 'standard', actionId })
      ).toEqual({ disabled: true, forcedValue: false })
    }
  })

  it('allows toggling for flexible standard actions', () => {
    for (const actionId of [
      'quickAiRequest',
      'voiceQuickAiRequest',
      'askInChat',
      'chatPromptsMenu',
    ] as const) {
      expect(
        resolveActionSelectionBehavior({ type: 'standard', actionId })
      ).toEqual({ disabled: false, forcedValue: null })
    }
  })

  it('handles profile actions according to their kind', () => {
    expect(
      resolveActionSelectionBehavior({
        type: 'profile',
        profileId: 'p1',
        action: 'screenshotQuickAiRequest',
      })
    ).toEqual({ disabled: true, forcedValue: false })

    expect(
      resolveActionSelectionBehavior({
        type: 'profile',
        profileId: 'p1',
        action: 'quickAiRequest',
      })
    ).toEqual({ disabled: false, forcedValue: null })

    expect(
      resolveActionSelectionBehavior({
        type: 'profile',
        profileId: 'p1',
        action: 'chat',
      })
    ).toEqual({ disabled: false, forcedValue: null })

    expect(
      resolveActionSelectionBehavior({
        type: 'profileChat',
        profileId: 'p1',
      })
    ).toEqual({ disabled: false, forcedValue: null })
  })

  it('handles commands based on their text and selection requirements', () => {
    const commands: CommandConfig[] = [
      {
        id: 'cmd-selection',
        name: 'Selection Cmd',
        description: '',
        icon: '',
        isEnabled: true,
        toolId: 'script',
        toolConfig: { command: 'echo {{SELECTION}}' },
      },
      {
        id: 'cmd-text',
        name: 'Text Cmd',
        description: '',
        icon: '',
        isEnabled: true,
        toolId: 'script',
        toolConfig: { command: 'echo {{TEXT}}' },
      },
      {
        id: 'cmd-none',
        name: 'No Text Cmd',
        description: '',
        icon: '',
        isEnabled: true,
        toolId: 'script',
        toolConfig: { command: 'date' },
      },
    ]

    const tools = testTools()

    expect(
      resolveActionSelectionBehavior(
        { type: 'command', commandId: 'cmd-selection' },
        commands,
        tools
      )
    ).toEqual({ disabled: true, forcedValue: true })

    expect(
      resolveActionSelectionBehavior(
        { type: 'command', commandId: 'cmd-text' },
        commands,
        tools
      )
    ).toEqual({ disabled: false, forcedValue: null })

    expect(
      resolveActionSelectionBehavior(
        { type: 'command', commandId: 'cmd-none' },
        commands,
        tools
      )
    ).toEqual({ disabled: true, forcedValue: false })
  })
})
