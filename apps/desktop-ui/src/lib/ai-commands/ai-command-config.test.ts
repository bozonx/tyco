import { describe, expect, it } from 'vitest'

import type { ActionPageConfig } from '@tyco/shared'

import { createCommand } from '../commands/command-config'
import {
  AD_HOC_AI_COMMAND_ID,
  adHocAiCommand,
  aiCommandFromPrompt,
  aiCommandToolConfigOf,
  callableCommands,
  maxStepsOf,
  savePromptAsCommand,
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

describe('commands from a typed request', () => {
  it('names a saved command by the first line and replaces the selection', () => {
    const command = aiCommandFromPrompt('  Shorten it\nkeep the tone ', 'id-1')
    expect(command).toMatchObject({
      id: 'id-1',
      name: 'Shorten it',
      toolId: 'core.aiTask',
      outputAction: 'insertIntoWindow',
      toolConfig: {
        prompt: 'Shorten it\nkeep the tone',
        allowedCommandIds: [],
        maxSteps: 5,
      },
    })
  })

  it('shows the output of a request run without saving', () => {
    expect(adHocAiCommand('Explain')).toMatchObject({
      id: AD_HOC_AI_COMMAND_ID,
      outputAction: 'showMenu',
    })
  })
})

describe('savePromptAsCommand', () => {
  const page = (slots: ActionPageConfig['slots']): ActionPageConfig => ({
    inputMode: 'selection',
    slots,
  })

  it('adds the command to the library and the first free key of a laid out page', () => {
    const saved = savePromptAsCommand(
      {
        commands: [],
        actionPages: [page({ q: { type: 'standard', actionId: 'askInChat' } })],
      },
      'Summarize',
      0,
      'new'
    )
    expect(saved.isAdded).toBe(true)
    expect(saved.commands.map((command) => command.id)).toEqual(['new'])
    expect(saved.actionPages[0]?.slots).toEqual({
      q: { type: 'standard', actionId: 'askInChat' },
      w: { type: 'command', commandId: 'new' },
    })
  })

  it('leaves a page without a layout as it is: it lists every command', () => {
    const pages = [page({})]
    const saved = savePromptAsCommand(
      { commands: [], actionPages: pages },
      'Summarize',
      0,
      'new'
    )
    expect(saved.actionPages).toEqual(pages)
  })

  it('does not save a prompt twice', () => {
    const existing = aiCommandFromPrompt('Summarize', 'old')
    const saved = savePromptAsCommand(
      { commands: [existing], actionPages: [page({})] },
      ' Summarize ',
      0
    )
    expect(saved.isAdded).toBe(false)
    expect(saved.commands).toEqual([existing])
  })
})
