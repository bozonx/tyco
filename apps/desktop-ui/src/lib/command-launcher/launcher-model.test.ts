import { describe, expect, it, vi } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { createCommand } from '../commands/command-config'
import {
  type CommandLauncherDependencies,
  createCommandLauncherModel,
  isLauncherCommand,
  searchCommands,
} from './launcher-model'

const command = (
  id: string,
  name: string,
  extra: Partial<CommandConfig> = {},
  toolConfig: Record<string, unknown> = {}
): CommandConfig => {
  const base = createCommand('webhook', id)
  return {
    ...base,
    name,
    confirm: 'auto',
    toolConfig: { ...base.toolConfig, url: 'https://x.test', ...toolConfig },
    ...extra,
  }
}

const backup = command('backup', 'Backup', {}, { takesText: false })
const note = command('note', 'Work note', {
  phrases: ['(write|add) to [the] notebook'],
})
const lights = command(
  'lights',
  'Свет в кабинете',
  { description: 'Turns the office lights on' },
  { takesText: false }
)

function setup(
  commands: CommandConfig[] = [backup, note, lights],
  extra: Partial<Pick<CommandLauncherDependencies, 'run'>> = {}
) {
  const deps = {
    commands: () => commands,
    selectedText: vi.fn<() => string | null>(() => null),
    run: vi.fn(async () => ({ success: true })),
    saveOutput: vi.fn(async () => {}),
    logRun: vi.fn(),
    ...extra,
  }
  return { deps, model: createCommandLauncherModel(deps) }
}

describe('isLauncherCommand', () => {
  it('offers enabled commands available in the overlay', () => {
    expect(isLauncherCommand(backup)).toBe(true)
    expect(isLauncherCommand({ ...backup, enabled: false })).toBe(false)
    expect(
      isLauncherCommand({
        ...backup,
        availableIn: { ...backup.availableIn, launcher: false },
      })
    ).toBe(false)
    expect(isLauncherCommand({ ...backup, toolId: 'notes.write' })).toBe(false)
  })
})

describe('searchCommands', () => {
  const commands = [backup, note, lights]

  it('keeps the order without a query', () => {
    expect(searchCommands(commands, '  ')).toEqual(commands)
  })

  it('puts a name prefix before a word prefix and a substring', () => {
    const up = command('up', 'Upload', {}, {})
    const backupNote = command('bn', 'Note on backup', {}, {})
    const all = [backupNote, up, backup]
    expect(searchCommands(all, 'back').map((item) => item.id)).toEqual([
      'backup',
      'bn',
    ])
    expect(searchCommands(all, 'up').map((item) => item.id)).toEqual([
      'up',
      'bn',
      'backup',
    ])
  })

  it('finds a command by its phrases without their syntax', () => {
    expect(searchCommands(commands, 'notebook')).toEqual([note])
    expect(searchCommands(commands, 'add to')).toEqual([note])
  })

  it('finds a command by its description', () => {
    expect(searchCommands(commands, 'office')).toEqual([lights])
  })

  it('ignores the case and ё', () => {
    const tea = command('tea', 'Чёрный чай', {}, {})
    expect(searchCommands([tea], 'ЧЕРН')).toEqual([tea])
  })
})

describe('createCommandLauncherModel', () => {
  it('lists only the commands of the overlay', () => {
    const hidden = { ...note, id: 'hidden', enabled: false }
    const { model } = setup([backup, hidden, lights])
    expect(model.visible.value.map((item) => item.id)).toEqual([
      'backup',
      'lights',
    ])
  })

  it('runs a command without text right away', async () => {
    const { deps, model } = setup()
    deps.selectedText.mockReturnValue('selected')
    await model.pickByKey(1)
    expect(deps.run).toHaveBeenCalledWith(backup, '', expect.anything())
    expect(deps.saveOutput).not.toHaveBeenCalled()
    expect(deps.logRun).toHaveBeenCalledWith({
      commandId: 'backup',
      name: 'Backup',
      source: 'launcher',
      success: true,
    })
    expect(model.stage.value.kind).toBe('list')
  })

  it('runs a text command on the selection', async () => {
    const { deps, model } = setup()
    deps.selectedText.mockReturnValue('buy milk')
    await model.pickByKey(2)
    expect(deps.saveOutput).toHaveBeenCalledWith('buy milk')
    expect(deps.run).toHaveBeenCalledWith(note, 'buy milk', expect.anything())
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'note', text: 'buy milk' })
    )
  })

  it('asks for the text when nothing is selected', async () => {
    const { deps, model } = setup()
    await model.pickByKey(2)
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value).toEqual({
      kind: 'prepare',
      command: note,
      autoRun: true,
    })
    expect(model.canSubmit.value).toBe(false)

    await model.submit()
    expect(deps.run).not.toHaveBeenCalled()

    model.setText('call mom')
    expect(model.canSubmit.value).toBe(true)
    await model.submit()
    expect(deps.run).toHaveBeenCalledWith(note, 'call mom', expect.anything())
    expect(model.stage.value.kind).toBe('list')
  })

  it('runs on a selection captured while asking for the text', async () => {
    const { deps, model } = setup()
    await model.pickByKey(2)
    await model.selectionArrived('late selection')
    expect(deps.run).toHaveBeenCalledWith(
      note,
      'late selection',
      expect.anything()
    )
    expect(model.stage.value.kind).toBe('list')
  })

  it('only fills in a late selection for a command that confirms', async () => {
    const confirmed = { ...note, confirm: 'always' as const }
    const { deps, model } = setup([confirmed])
    await model.pickByKey(1)
    await model.selectionArrived('late selection')
    expect(model.text.value).toBe('late selection')
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('keeps the typed text from a selection captured late', async () => {
    const { model } = setup()
    await model.pickByKey(2)
    model.setText('typed')
    await model.selectionArrived('late selection')
    expect(model.text.value).toBe('typed')
  })

  it('asks to confirm a command that wants it', async () => {
    const confirmed = { ...backup, confirm: 'always' as const }
    const { deps, model } = setup([confirmed])
    await model.pickHighlighted()
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value).toEqual({
      kind: 'prepare',
      command: confirmed,
      autoRun: false,
    })
    expect(model.canSubmit.value).toBe(true)
    await model.submit()
    expect(deps.run).toHaveBeenCalledWith(confirmed, '', expect.anything())
  })

  it('shows the selection for confirmation', async () => {
    const confirmed = { ...note, confirm: 'always' as const }
    const { deps, model } = setup([confirmed])
    deps.selectedText.mockReturnValue('selected')
    await model.pickHighlighted()
    expect(model.stage.value.kind).toBe('prepare')
    expect(model.text.value).toBe('selected')
  })

  it('keeps the text for another try when the command fails', async () => {
    const run = vi.fn(async () => ({ success: false, message: 'HTTP 500' }))
    const { deps, model } = setup(undefined, { run })
    await model.pickByKey(2)
    model.setText('text')
    await model.submit()
    expect(model.stage.value).toEqual({
      kind: 'prepare',
      command: note,
      autoRun: false,
    })
    expect(model.text.value).toBe('text')
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'HTTP 500' })
    )
  })

  it('goes back to the list when a command without text fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    const { deps, model } = setup(undefined, { run })
    await model.pickByKey(1)
    expect(model.stage.value.kind).toBe('list')
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'boom' })
    )
  })

  it('does not start another command while one runs', async () => {
    let finish: (value: { success: boolean }) => void = () => {}
    const run = vi.fn(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          finish = resolve
        })
    )
    const { model } = setup(undefined, { run })
    const first = model.pickByKey(1)
    await Promise.resolve()
    await model.pickByKey(3)
    finish({ success: true })
    await first
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('leaves a new activation alone when a run ends', async () => {
    let finish: (value: { success: boolean }) => void = () => {}
    const run = vi.fn(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          finish = resolve
        })
    )
    const { model } = setup(undefined, { run })
    const first = model.pickByKey(1)
    await Promise.resolve()
    model.reset()
    model.setQuery('note')
    finish({ success: false })
    await first
    expect(model.stage.value.kind).toBe('list')
    expect(model.query.value).toBe('note')
  })

  it('filters with the query and picks by the place in the result', async () => {
    const { deps, model } = setup()
    model.setQuery('свет')
    expect(model.visible.value).toEqual([lights])
    await model.pickByKey(1)
    expect(deps.run).toHaveBeenCalledWith(lights, '', expect.anything())
    await model.pickByKey(2)
    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('moves the highlight around the list', async () => {
    const { deps, model } = setup()
    model.move(-1)
    expect(model.highlighted.value).toBe(2)
    model.move(1)
    expect(model.highlighted.value).toBe(0)
    model.move(1)
    deps.selectedText.mockReturnValue('x')
    await model.pickHighlighted()
    expect(deps.run).toHaveBeenCalledWith(note, 'x', expect.anything())
  })

  it('goes back from a prepared command to the list', async () => {
    const { model } = setup()
    expect(model.back()).toBe(false)
    await model.pickByKey(2)
    expect(model.back()).toBe(true)
    expect(model.stage.value.kind).toBe('list')
  })
})

describe('external calls', () => {
  const lamp = command(
    'lamp',
    'Lamp',
    { availableIn: { launcher: false, external: true, chat: false } },
    { takesText: false }
  )

  function setupExternal(commands: CommandConfig[]) {
    const commandMissing = vi.fn()
    const { deps } = setup(commands)
    const model = createCommandLauncherModel({ ...deps, commandMissing })
    return { deps, model, commandMissing }
  }

  it('runs a command missing from the overlay list on the given text', async () => {
    const hidden = {
      ...note,
      availableIn: { launcher: false, external: true, chat: false },
    }
    const { deps, model } = setupExternal([hidden])
    await model.request({ commandId: 'note', text: 'from LHC' })
    expect(deps.run).toHaveBeenCalledWith(hidden, 'from LHC', expect.anything())
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'external', text: 'from LHC' })
    )
  })

  it('takes the selection when the call brings no text', async () => {
    const { deps, model } = setupExternal([note])
    deps.selectedText.mockReturnValue('selected')
    await model.request({ commandId: 'note' })
    expect(deps.run).toHaveBeenCalledWith(note, 'selected', expect.anything())
  })

  it('asks for the text, then runs on a selection captured late', async () => {
    const { deps, model } = setupExternal([note])
    await model.request({ commandId: 'note' })
    expect(model.stage.value.kind).toBe('prepare')
    await model.selectionArrived('late')
    expect(deps.run).toHaveBeenCalledWith(note, 'late', expect.anything())
  })

  it('asks to confirm a command that wants it', async () => {
    const confirmed = { ...lamp, confirm: 'always' as const }
    const { deps, model } = setupExternal([confirmed])
    await model.request({ commandId: 'lamp' })
    expect(model.stage.value).toEqual({
      kind: 'prepare',
      command: confirmed,
      autoRun: false,
    })
    expect(deps.run).not.toHaveBeenCalled()
    await model.submit()
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'external' })
    )
  })

  it('reports a command gone from the library', async () => {
    const { deps, model, commandMissing } = setupExternal([note])
    await model.request({ commandId: 'gone' })
    expect(commandMissing).toHaveBeenCalledWith('gone')
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value.kind).toBe('list')
  })

  it('logs a command picked from the list after a call as the overlay', async () => {
    const { deps, model } = setupExternal([note, lamp])
    await model.request({ commandId: 'note' })
    model.back()
    await model.pick(lamp)
    expect(deps.logRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ commandId: 'lamp', source: 'launcher' })
    )
  })
})

describe('cancelling a running command', () => {
  it('aborts the run and goes back to the text', async () => {
    let signal: AbortSignal | undefined
    const run = vi.fn(
      (
        _command: CommandConfig,
        _text: string,
        options?: { signal?: AbortSignal }
      ) =>
        new Promise<{ success: boolean; cancelled?: boolean }>((resolve) => {
          signal = options?.signal
          signal?.addEventListener('abort', () =>
            resolve({ success: false, cancelled: true })
          )
        })
    )
    const { deps, model } = setup(undefined, { run })
    deps.selectedText.mockReturnValue('text')
    const running = model.pickByKey(2)
    await Promise.resolve()
    await Promise.resolve()
    expect(model.stage.value.kind).toBe('running')
    model.cancel()
    await running
    expect(signal?.aborted).toBe(true)
    expect(model.stage.value.kind).toBe('prepare')
    expect(model.text.value).toBe('text')
  })
})
