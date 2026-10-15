import { describe, expect, it, vi } from 'vitest'
import { createCommand } from '../commands/command-config'
import { testTools } from '../tools/testing'
import {
  createVoiceCommandModel,
  type VoiceCommandDependencies,
} from './voice-command-model'

function setup(isAutoRunEnabled = false) {
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
  if (!isAutoRunEnabled) model.isAutoRunEnabled.value = false
  return {
    commands,
    deps,
    model,
    partial: (text: string) => handlers?.onText({ committed: '', draft: text }),
  }
}

describe('voice command session', () => {
  it('previews revised partials, waits for final STT and requires confirmation when automatic execution is disabled', async () => {
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
    const { model, deps, partial } = setup()
    model.isAutoRunEnabled.value = true
    await model.start()
    partial('save note Early')
    expect(deps.run).not.toHaveBeenCalled()
    await model.finish()
    expect(deps.run).toHaveBeenCalledOnce()
  })
  it('does not run after cancellation or when an old final response arrives', async () => {
    const { model, deps } = setup()
    model.isAutoRunEnabled.value = true
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
    const { model, deps, commands } = setup(true)
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
    model.isAutoRunEnabled.value = true
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

it('clears the previous execution error when retrying successfully', async () => {
  const { model, deps } = setup()
  deps.run = vi
    .fn()
    .mockResolvedValueOnce({ success: false, message: 'Failed' })
    .mockResolvedValueOnce({ success: true })
  await model.start()
  await model.finish()
  await model.run()
  expect(model.error.value).toBe('Failed')
  await model.run()
  expect(model.error.value).toBe('')
})

it('preserves text on STT start and finish failures and allows a fresh recording', async () => {
  const { model, deps, partial } = setup()
  await model.start()
  partial('save note Keep this')
  deps.finishDictation = vi
    .fn()
    .mockRejectedValueOnce(new Error('STT finish failed'))
    .mockResolvedValueOnce('save note Recovered')
  await model.finish()
  expect(model.error.value).toBe('STT finish failed')
  expect(model.transcript.value).toBe('save note Keep this')
  deps.startDictation = vi
    .fn()
    .mockRejectedValueOnce(new Error('Microphone unavailable'))
    .mockResolvedValueOnce(undefined)
  await model.start()
  expect(model.stage.value).toBe('review')
  expect(model.transcript.value).toBe('save note Keep this')
  await model.start()
  await model.finish()
  expect(model.inputText.value).toBe('Recovered')
  expect(deps.run).not.toHaveBeenCalled()
})

it('serializes a new activation behind cancellation of a pending microphone start', async () => {
  const { model, deps } = setup()
  let release!: () => void
  deps.startDictation = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    .mockResolvedValueOnce(undefined)
  const first = model.start()
  await Promise.resolve()
  const cancellation = model.cancel()
  const second = model.start()
  await Promise.resolve()
  expect(deps.startDictation).toHaveBeenCalledOnce()
  release()
  await Promise.all([first, cancellation, second])
  expect(deps.startDictation).toHaveBeenCalledTimes(2)
  expect(model.stage.value).toBe('recording')
  expect(deps.run).not.toHaveBeenCalled()
})

it('waits for cleanup after recognition failure before starting another recording', async () => {
  const { model, deps } = setup()
  let handlers!: Parameters<VoiceCommandDependencies['startDictation']>[0]
  deps.startDictation = vi.fn(async (next) => {
    handlers = next
  })
  await model.start()
  const oldHandlers = handlers
  let release!: () => void
  deps.cancelDictation = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  oldHandlers.onText({ committed: '', draft: 'save note Keep this' })
  oldHandlers.onError(new Error('Connection lost'))
  const restarting = model.start()
  await Promise.resolve()
  expect(deps.startDictation).toHaveBeenCalledOnce()
  release()
  await restarting
  expect(deps.startDictation).toHaveBeenCalledTimes(2)
  oldHandlers.onText({ committed: '', draft: 'save note Stale' })
  oldHandlers.onError(new Error('Stale failure'))
  expect(model.transcript.value).toBe('save note Keep this')
  expect(model.error.value).toBe('')
  expect(model.stage.value).toBe('recording')
  expect(deps.run).not.toHaveBeenCalled()
})

it('does not automatically execute a manually recovered parameter', async () => {
  const { model, deps, commands } = setup()
  model.isAutoRunEnabled.value = true
  deps.finishDictation = vi.fn(async () => 'unknown input')
  await model.start()
  await model.finish()
  model.choose({
    commandId: commands[0]!.id,
    parameters: { language: 'en_US' },
    text: 'Hello!',
    consumedWordCount: 0,
    textOffset: 0,
  })
  expect(deps.run).not.toHaveBeenCalled()
  expect(model.canRun.value).toBe(true)
  await model.run()
  expect(deps.run).toHaveBeenCalledOnce()
})

it('automatically runs the final exact command by default regardless of the legacy confirmation setting', async () => {
  const { model, deps, partial } = setup(true)
  expect(model.isAutoRunEnabled.value).toBe(true)
  await model.start()
  partial('save note Draft')
  expect(deps.run).not.toHaveBeenCalled()
  await model.finish()
  expect(deps.run).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: 'note', voiceConfirmation: 'always' }),
    'Hello!',
    expect.any(AbortSignal)
  )
})

it('waits for manual execution when the checkbox is disabled even for a legacy automatic command', async () => {
  const { model, deps, commands } = setup()
  commands[0]!.voiceConfirmation = 'auto'
  await model.start()
  await model.finish()
  expect(deps.run).not.toHaveBeenCalled()
  await model.run()
  expect(deps.run).toHaveBeenCalledOnce()
  await model.cancel()
  await model.start()
  expect(model.isAutoRunEnabled.value).toBe(false)
})
