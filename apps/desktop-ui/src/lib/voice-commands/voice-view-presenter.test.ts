import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../commands/command-config'
import {
  DEFAULT_TRANSLATION_ID,
  isTranslationCommand,
  pickVoiceCatalogEntry,
  resolveVoiceNotice,
  voiceEntryLabel,
  voiceEntryPhrases,
} from './voice-view-presenter'
import { buildVoiceCatalog } from './voice-catalog'

const t = (key: string) => key

describe('voice-view-presenter', () => {
  it('identifies built-in translation commands and formats entry labels', () => {
    const translateCmd = {
      ...createCommand('core.translate', DEFAULT_TRANSLATION_ID),
      toolConfig: { language: 'en-US' },
    }
    const customCmd = {
      ...createCommand('script', 'custom-1'),
      name: 'Deploy',
      phrases: ['deploy now'],
    }
    expect(isTranslationCommand(translateCmd)).toBe(true)
    expect(isTranslationCommand(customCmd)).toBe(false)

    const entries = buildVoiceCatalog(
      [translateCmd, customCmd],
      DEFAULT_TRANSLATION_ID
    )
    expect(voiceEntryLabel(entries[0]!, t)).toBe('tools.translate')
    expect(voiceEntryLabel(entries[1]!, t)).toBe('Deploy')
    expect(
      voiceEntryPhrases(
        entries[1]!,
        [{ commandId: 'custom-1', phrase: 'deploy now', parameters: [] }],
        t
      )
    ).toEqual(['deploy now'])
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
  })

  it('picks marked candidate when available or falls back to command id', () => {
    const cmd = createCommand('script', 'cmd-1')
    const entry = buildVoiceCatalog([cmd], DEFAULT_TRANSLATION_ID)[0]!
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
      pickVoiceCatalogEntry(entry, {
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
      pickVoiceCatalogEntry(entry, {
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
