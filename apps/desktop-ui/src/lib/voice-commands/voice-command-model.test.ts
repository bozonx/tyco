import { describe, expect, it, vi } from 'vitest'
import { createCommand } from '../commands/command-config'
import { testTools } from '../tools/testing'
import {
  createVoiceCommandModel,
  type VoiceCommandDependencies,
} from './voice-command-model'

function setup() {
  const commands = [
    {
      ...createCommand('script', 'note'),
      isVoiceEnabled: true,
      phrases: ['save note'],
      toolConfig: { command: 'echo {{TEXT}}' },
    },
  ]
  let handlers:
    Parameters<VoiceCommandDependencies['startDictation']>[0] | undefined
  const deps: VoiceCommandDependencies = {
    commands: () => commands,
    tools: testTools(),
    startDictation: vi.fn(async (next) => {
      handlers = next
    }),
    finishDictation: vi.fn(async () => 'save note Hello!'),
    cancelDictation: vi.fn(async () => {}),
    run: vi.fn(async () => ({ success: true })),
  }
  const model = createVoiceCommandModel(deps)
  return {
    commands,
    deps,
    model,
    partial: (text: string) => handlers?.onText({ committed: '', draft: text }),
  }
}

describe('voice command session', () => {
  it('previews revised partials, waits for final STT and requires confirmation by default', async () => {
    const { model, deps, partial } = setup()
    await model.start()
    partial('save note Early')
    expect(model.resolution.value.kind).toBe('match')
    partial('unrelated')
    expect(model.resolution.value.kind).toBe('none')
    expect(deps.run).not.toHaveBeenCalled()
    await model.finish()
    expect(model.inputText.value).toBe('Hello!')
    expect(deps.run).not.toHaveBeenCalled()
    await model.run()
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note' }),
      'Hello!',
      expect.any(AbortSignal)
    )
  })
  it('runs only exact final valid input when the user allows automatic execution', async () => {
    const { model, deps, commands, partial } = setup()
    commands[0]!.voiceConfirmation = 'auto'
    await model.start()
    partial('save note Early')
    expect(deps.run).not.toHaveBeenCalled()
    await model.finish()
    expect(deps.run).toHaveBeenCalledOnce()
  })
  it('does not run after cancellation or when an old final response arrives', async () => {
    const { model, deps, commands } = setup()
    commands[0]!.voiceConfirmation = 'auto'
    let resolve!: (text: string) => void
    deps.finishDictation = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    await model.start()
    const finishing = model.finish()
    await Promise.resolve()
    await model.cancel()
    resolve('save note Late')
    await finishing
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value).toBe('idle')
  })
  it('requires choosing an ambiguous candidate and preserves the entire manual input', async () => {
    const { model, deps, commands } = setup()
    commands.push({ ...commands[0]!, id: 'second' })
    await model.start()
    await model.finish()
    expect(model.resolution.value.kind).toBe('ambiguous')
    expect(deps.run).not.toHaveBeenCalled()
    model.chooseCommand('second')
    expect(model.inputText.value).toBe('save note Hello!')
  })
  it('rejects missing or extra input without substituting a selection', async () => {
    const { model, deps, commands } = setup()
    commands[0]!.voiceConfirmation = 'auto'
    deps.finishDictation = vi.fn(async () => 'save note')
    await model.start()
    await model.finish()
    expect(model.inputIssue.value).toBe('missing-text')
    expect(deps.run).not.toHaveBeenCalled()
    commands[0]!.toolConfig = { command: 'backup' }
    model.inputText.value = 'actually cancel'
    expect(model.inputIssue.value).toBe('extra-text')
    await model.run()
    expect(deps.run).not.toHaveBeenCalled()
  })
  it('rechecks permissions on submission and retains input on failure', async () => {
    const { model, deps, commands } = setup()
    await model.start()
    await model.finish()
    commands[0]!.isVoiceEnabled = false
    await model.run()
    expect(deps.run).not.toHaveBeenCalled()
    commands[0]!.isVoiceEnabled = true
    deps.run = vi.fn(async () => ({ success: false, message: 'Unavailable' }))
    await model.run()
    expect(model.inputText.value).toBe('Hello!')
    expect(model.error.value).toBe('Unavailable')
    expect(model.stage.value).toBe('review')
    expect(deps.run).toHaveBeenCalledOnce()
  })
})
