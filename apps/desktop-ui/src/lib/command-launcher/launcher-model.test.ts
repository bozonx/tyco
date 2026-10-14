import { describe, expect, it, vi } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { createCommand } from '../commands/command-config'
import { testTools } from '../tools/testing'
import {
  type CommandLauncherDependencies,
  createCommandLauncherModel,
  isLauncherCommand,
  searchCommands,
} from './launcher-model'

const tools = testTools()

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
    toolConfig: {
      ...base.toolConfig,
      url: 'https://x.test/?q={{TEXT}}',
      ...toolConfig,
    },
    ...extra,
  }
}

const backup = command('backup', 'Backup', {}, { url: 'https://x.test' })
const note = command('note', 'Work note', {
  phrases: ['(write|add) to [the] notebook'],
})
const lights = command(
  'lights',
  'Свет в кабинете',
  { description: 'Turns the office lights on' },
  { url: 'https://x.test' }
)

function setup(
  commands: CommandConfig[] = [backup, note, lights],
  extra: Partial<Pick<CommandLauncherDependencies, 'run'>> = {}
) {
  const deps = {
    tools,
    commands: () => commands,
    launcherPages: () => [
      {
        id: 'main',
        inputMode: 'selection' as const,
        slots: commands.map((command) => command.id),
      },
    ],
    selectedText: vi.fn<() => string | null>(() => null),
    run: vi.fn(async () => ({ success: true, result: undefined })),
    saveOutput: vi.fn(async () => {}),
    logRun: vi.fn(),
    ...extra,
  }
  return { deps, model: createCommandLauncherModel(deps) }
}

describe('isLauncherCommand', () => {
  it('offers enabled commands whose tool is available', () => {
    expect(isLauncherCommand(backup, tools)).toBe(true)
    expect(isLauncherCommand({ ...backup, enabled: false }, tools)).toBe(false)
    expect(isLauncherCommand({ ...backup, toolId: 'notes.write' }, tools)).toBe(
      false
    )
  })
})

describe('slotCommands and pickSlot', () => {
  it('maps page slots to commands and runs the selected slot', async () => {
    const run = vi.fn(async () => ({ success: true, result: undefined }))
    const deps = {
      tools,
      commands: () => [backup, note],
      launcherPages: () => [
        {
          id: 'main',
          slots: ['note', null, 'backup'],
          inputMode: 'selection' as const,
        },
      ],
      selectedText: () => null,
      run,
    }
    const model = createCommandLauncherModel(deps)
    expect(model.slotCommands.value[0]?.id).toBe('note')
    expect(model.slotCommands.value[1]).toBeNull()
    expect(model.slotCommands.value[2]?.id).toBe('backup')

    await model.pickSlot(2)
    expect(run).toHaveBeenCalledWith(backup, '', expect.anything())
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
    expect(model.filteredCommands.value.map((item) => item.id)).toEqual([
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
    expect(deps.run).toHaveBeenCalledWith(
      note,
      'buy milk',
      expect.objectContaining({ source: 'launcher' })
    )
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
    expect(deps.run).toHaveBeenCalledWith(
      note,
      'call mom',
      expect.objectContaining({ source: 'launcher' })
    )
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

  it('keeps the typed text from a selection captured late', async () => {
    const { model } = setup()
    await model.pickByKey(2)
    model.setText('typed')
    await model.selectionArrived('late selection')
    expect(model.inputText.value).toBe('typed')
  })

  it('asks for the text once the selection is dropped', async () => {
    const { deps, model } = setup()
    deps.selectedText.mockReturnValue('leftover')
    model.dropSelection()
    expect(model.selection.value).toBe('')
    await model.pickByKey(2)
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value.kind).toBe('prepare')
    expect(model.inputText.value).toBe('')

    await model.selectionArrived('leftover')
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('takes the selection again after a reset', () => {
    const { deps, model } = setup()
    deps.selectedText.mockReturnValue('selected')
    model.dropSelection()
    model.reset()
    expect(model.selection.value).toBe('selected')
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
    expect(model.inputText.value).toBe('text')
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
    expect(model.filteredCommands.value).toEqual([lights])
    await model.pickByKey(1)
    expect(deps.run).toHaveBeenCalledWith(lights, '', expect.anything())
    await model.pickByKey(2)
    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('moves the highlight around the list', async () => {
    const { deps, model } = setup()
    model.move(-1)
    expect(model.highlightedCommandIndex.value).toBe(2)
    model.move(1)
    expect(model.highlightedCommandIndex.value).toBe(0)
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
    { availableIn: { external: true, chat: false } },
    { url: 'https://x.test' }
  )

  function setupExternal(commands: CommandConfig[]) {
    const commandMissing = vi.fn()
    const { deps } = setup(commands)
    const model = createCommandLauncherModel({ ...deps, commandMissing })
    return { deps, model, commandMissing }
  }

  it('runs a command missing from the overlay list on the given text', async () => {
    const hidden = { ...note, availableIn: { external: true, chat: false } }
    const { deps, model } = setupExternal([hidden])
    await model.request({ commandId: 'note', text: 'from LHC' })
    expect(deps.run).toHaveBeenCalledWith(hidden, 'from LHC', expect.anything())
    expect(deps.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'external', text: 'from LHC' })
    )
  })

  it('asks for explicit text without capturing the selection for external calls', async () => {
    const { deps, model } = setupExternal([note])
    deps.selectedText.mockReturnValue('selected')
    await model.request({ commandId: 'note' })
    expect(model.stage.value.kind).toBe('prepare')
    expect(deps.run).not.toHaveBeenCalled()
    await model.selectionArrived('late')
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.inputText.value).toBe('')
    model.setText('explicit')
    await model.submit()
    expect(deps.run).toHaveBeenCalledWith(
      note,
      'explicit',
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
    expect(model.inputText.value).toBe('text')
  })
})

describe('commands that replace the selection', () => {
  const replacing = command(
    'translate',
    'Translate',
    { launcherAfterRun: { action: 'insertIntoWindow' } },
    {}
  )

  function setupReplacing(commands: CommandConfig[] = [replacing]) {
    const replaceSelection = vi.fn(async () => {})
    const { deps } = setup(commands)
    const model = createCommandLauncherModel({ ...deps, replaceSelection })
    return { deps, model, replaceSelection }
  }

  it('hands the selection over to a selection run', async () => {
    const { deps, model, replaceSelection } = setupReplacing()
    deps.selectedText.mockReturnValue('hola')
    await model.pickByKey(1)
    expect(replaceSelection).toHaveBeenCalledWith(replacing)
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value.kind).toBe('list')
  })

  it('hands over a selection captured while asking for the text', async () => {
    const { model, replaceSelection } = setupReplacing()
    await model.pickByKey(1)
    await model.selectionArrived('hola')
    expect(replaceSelection).toHaveBeenCalledWith(replacing)
  })

  it('runs a typed or edited text itself, for the paste sink', async () => {
    const { deps, model, replaceSelection } = setupReplacing()
    await model.pickByKey(1)
    model.setText('hola amigo')
    await model.submit()
    expect(replaceSelection).not.toHaveBeenCalled()
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'translate' }),
      'hola amigo',
      expect.anything()
    )
  })

  it('treats the text of an external call as no selection', async () => {
    const { deps, model, replaceSelection } = setupReplacing()
    await model.request({ commandId: 'translate', text: 'hola' })
    expect(replaceSelection).not.toHaveBeenCalled()
    expect(deps.run).toHaveBeenCalledWith(
      replacing,
      'hola',
      expect.objectContaining({ source: 'external' })
    )
  })
})

describe('external job requests', () => {
  it('requires explicit input and ignores selections arriving after activation', async () => {
    const { deps } = setup([note])
    const claimJob = vi.fn(async () => true)
    const finishJob = vi.fn(async () => {})
    const model = createCommandLauncherModel({
      ...deps,
      selectedText: () => 'private selection',
      claimJob,
      finishJob,
    })
    await model.request({ commandId: note.id, jobId: 'job-input' })
    await model.selectionArrived('another private selection')
    expect(model.stage.value.kind).toBe('prepare')
    expect(deps.run).not.toHaveBeenCalled()
    model.setText('explicit text')
    await model.submit()
    expect(claimJob).toHaveBeenCalledWith('job-input')
    expect(deps.run).toHaveBeenCalledWith(
      note,
      'explicit text',
      expect.objectContaining({ source: 'external' })
    )
    expect(finishJob).toHaveBeenCalledWith('job-input', {
      success: true,
      result: undefined,
    })
  })

  it('does not claim a job until the text is given and cancels an abandoned prompt', async () => {
    const { deps } = setup([note])
    const claimJob = vi.fn(async () => true)
    const finishJob = vi.fn(async () => {})
    const model = createCommandLauncherModel({ ...deps, claimJob, finishJob })
    await model.request({ commandId: note.id, jobId: 'job-text' })
    expect(model.stage.value.kind).toBe('prepare')
    expect(claimJob).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
    model.cancelExternal('job-text')
    expect(finishJob).toHaveBeenCalledWith(
      'job-text',
      expect.objectContaining({ success: false, cancelled: true })
    )
  })
  it('leaves a job it could not claim to its owner', async () => {
    const { deps } = setup([note])
    const finishJob = vi.fn(async () => {})
    const model = createCommandLauncherModel({
      ...deps,
      claimJob: vi.fn(async () => false),
      finishJob,
    })
    await model.request({ commandId: note.id, jobId: 'job-taken', text: 'x' })
    expect(deps.run).not.toHaveBeenCalled()
    expect(finishJob).not.toHaveBeenCalled()
  })

  it('finishes a job cancelled while running only once', async () => {
    const { deps } = setup([note])
    let finishRun!: () => void
    vi.mocked(deps.run).mockImplementation(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          finishRun = () => resolve({ success: true })
        })
    )
    const finishJob = vi.fn(async () => {})
    const model = createCommandLauncherModel({
      ...deps,
      claimJob: vi.fn(async () => true),
      finishJob,
    })
    const running = model.request({
      commandId: note.id,
      jobId: 'job-once',
      text: 'x',
    })
    await vi.waitFor(() => expect(deps.run).toHaveBeenCalled())
    model.reset()
    finishRun()
    await running
    expect(finishJob).toHaveBeenCalledOnce()
    expect(finishJob).toHaveBeenCalledWith(
      'job-once',
      expect.objectContaining({ cancelled: true })
    )
  })
})

describe('launcher pages', () => {
  it('switches independent slots, wraps and rejects absent pages', () => {
    const { deps } = setup()
    const model = createCommandLauncherModel({
      ...deps,
      launcherPages: () =>
        ['backup', 'note', 'lights'].map((id) => ({
          id,
          slots: [id],
          inputMode: 'selection' as const,
        })),
    })
    expect(model.slotCommands.value[0]?.id).toBe('backup')
    model.nextPage()
    expect(model.slotCommands.value[0]?.id).toBe('note')
    model.setPage(2)
    expect(model.slotCommands.value[0]?.id).toBe('lights')
    model.setPage(3)
    expect(model.pageIndex.value).toBe(2)
    model.nextPage()
    expect(model.pageIndex.value).toBe(0)
    model.nextPage(-1)
    expect(model.pageIndex.value).toBe(2)
  })

  it('runs the commands of a page without text on no selection', async () => {
    const { deps } = setup()
    deps.selectedText.mockReturnValue('leftover')
    const model = createCommandLauncherModel({
      ...deps,
      launcherPages: () => [
        { id: 'main', slots: ['note'], inputMode: 'selection' as const },
        { id: 'other', slots: ['note'], inputMode: 'none' as const },
      ],
    })
    model.setPage(1)
    expect(model.selection.value).toBe('')
    await model.pickSlot(0)
    expect(deps.run).not.toHaveBeenCalled()
    expect(model.stage.value.kind).toBe('prepare')
    await model.selectionArrived('leftover')
    expect(deps.run).not.toHaveBeenCalled()

    model.reset()
    expect(model.selection.value).toBe('leftover')
    await model.pickSlot(0)
    expect(deps.run).toHaveBeenCalledWith(note, 'leftover', expect.anything())
  })
})

describe('launcher disposal', () => {
  it('aborts the command and suppresses late logging', async () => {
    let resolve!: (outcome: { success: boolean }) => void
    let signal: AbortSignal | undefined
    const { model, deps } = setup([backup], {
      run: async (_command, _text, options) => {
        signal = options?.signal
        return new Promise((done) => {
          resolve = done
        })
      },
    })
    const pending = model.pick(backup)
    await vi.waitFor(() => expect(signal).toBeDefined())
    model.dispose()
    expect(signal?.aborted).toBe(true)
    resolve({ success: true })
    await pending
    expect(deps.logRun).not.toHaveBeenCalled()
    expect(model.stage.value.kind).toBe('list')
  })
})

describe('launcher completion ownership', () => {
  it('does not log a job completion that arrives after disposal', async () => {
    let finish!: (outcome: { success: boolean }) => void
    const logRun = vi.fn()
    const finishJob = vi.fn(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          finish = resolve
        })
    )
    const model = createCommandLauncherModel({
      tools,
      commands: () => [backup],
      launcherPages: () => [
        { id: 'main', slots: [backup.id], inputMode: 'selection' as const },
      ],
      selectedText: () => null,
      run: async () => ({ success: true }),
      claimJob: async () => true,
      finishJob,
      logRun,
    })
    const pending = model.request({ commandId: backup.id, jobId: 'job' })
    await vi.waitFor(() => expect(finishJob).toHaveBeenCalledOnce())
    model.dispose()
    finish({ success: true })
    await pending
    expect(logRun).not.toHaveBeenCalled()
    expect(finishJob).toHaveBeenCalledOnce()
  })
})
