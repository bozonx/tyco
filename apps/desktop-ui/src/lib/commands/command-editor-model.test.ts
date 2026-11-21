import { describe, expect, it } from 'vitest'

import { createCommand } from './command-config'
import {
  countAdvancedCustomizations,
  createCommandEditorModel,
} from './command-editor-model'

describe('command editor model', () => {
  it('removes optional values and preserves unrelated config when editing', () => {
    let command = {
      ...createCommand('script', 'test'),
      description: 'Previous',
      operationConfig: { command: 'echo test' },
    }
    const model = createCommandEditorModel({
      getCommand: () => command,
      update: (value) => {
        command = value as typeof command
      },
    })
    model.updateDescription(' ')
    expect(command.description).toBe('')
    expect(command.operationConfig.command).toBe('echo test')
  })
  it('sets the output action of quick commands', () => {
    let command = createCommand('script', 'test')
    const model = createCommandEditorModel({
      getCommand: () => command,
      update: (value) => {
        command = value
      },
    })
    model.updateOutputAction('insertIntoWindow')
    expect(command.outputAction).toBe('insertIntoWindow')
  })

  it('counts customizations for advanced settings against defaults', () => {
    const base = createCommand('script', 'test')
    expect(
      countAdvancedCustomizations(base, {
        defaultOutputAction: 'none',
        canLogOutput: true,
        canSelectPlatforms: true,
      })
    ).toBe(0)

    expect(
      countAdvancedCustomizations(
        { ...base, description: 'Ask LLM' },
        { defaultOutputAction: 'none' }
      )
    ).toBe(1)

    expect(
      countAdvancedCustomizations(
        {
          ...base,
          description: 'Ask LLM',
          isVoiceEnabled: true,
          outputAction: 'copyToClipboard',
          isAvailableExternally: true,
          isOutputLogged: true,
          platforms: ['linux'],
          isLlmArgumentParsingEnabled: true,
          isLlmPreTransformEnabled: true,
        },
        {
          defaultOutputAction: 'none',
          canLogOutput: true,
          canSelectPlatforms: true,
          canParseArguments: true,
          canPreTransform: true,
        }
      )
    ).toBe(8)
  })
})
