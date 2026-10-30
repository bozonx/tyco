import type { AiTaskConfig } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  createTaskExecution,
  type TaskExecutionDependencies,
  type TaskExecutionHistory,
} from './task-execution'
import type { TaskRunResult } from './task-runner'

const task = { id: 'fix' } as AiTaskConfig

const runResult = (patch: Partial<TaskRunResult> = {}): TaskRunResult => ({
  content: 'done',
  reasoning: '',
  toolCalls: [],
  effectiveOutputAction: 'show',
  wasFocusGuardTriggered: false,
  stepsUsed: 1,
  ...patch,
})

function setup(patch: Partial<TaskExecutionDependencies> = {}) {
  const history = {
    saveSource: vi.fn<TaskExecutionHistory['saveSource']>(
      async () => 'source-1'
    ),
    saveSourceResult: vi.fn<TaskExecutionHistory['saveSourceResult']>(
      async () => {}
    ),
    saveOutput: vi.fn<TaskExecutionHistory['saveOutput']>(async () => {}),
  }
  const deps: TaskExecutionDependencies = {
    run: vi.fn(async () => runResult()),
    history,
    getInsert: vi.fn(() => undefined),
    onHistoryError: vi.fn(),
    ...patch,
  }
  return { deps, history, execution: createTaskExecution(deps) }
}

describe('createTaskExecution', () => {
  it('skips blank text without running', async () => {
    const { deps, execution } = setup()
    expect(await execution.execute(task, '  ')).toEqual({ kind: 'empty' })
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('shows the result and records source and answer', async () => {
    const { deps, history, execution } = setup()
    expect(await execution.execute(task, ' text ')).toEqual({
      kind: 'show',
      content: 'done',
      wasFocusGuardTriggered: false,
    })
    expect(deps.run).toHaveBeenCalledWith(task, 'text', {})
    expect(history.saveSourceResult).toHaveBeenCalledWith('source-1', 'done')
  })

  it('inserts into the target and records the output', async () => {
    const insert = vi.fn(async () => {})
    const { history, execution } = setup({
      run: vi.fn(async () => runResult({ effectiveOutputAction: 'replace' })),
      getInsert: () => insert,
    })
    expect(await execution.execute(task, 'text')).toEqual({ kind: 'inserted' })
    expect(insert).toHaveBeenCalledWith('done')
    expect(history.saveOutput).toHaveBeenCalledWith('done')
  })

  it('falls back to showing when the target is gone', async () => {
    const { execution } = setup({
      run: vi.fn(async () => runResult({ effectiveOutputAction: 'insert' })),
    })
    expect(await execution.execute(task, 'text')).toEqual({
      kind: 'show',
      content: 'done',
      wasFocusGuardTriggered: true,
    })
  })

  it('reports history failures without failing the task', async () => {
    const failure = new Error('disk full')
    const { deps, history, execution } = setup({
      run: vi.fn(async () =>
        runResult({ effectiveOutputAction: 'notify_and_close' })
      ),
    })
    history.saveSource.mockRejectedValue(failure)
    history.saveOutput.mockRejectedValue(failure)
    expect(await execution.execute(task, 'text')).toEqual({
      kind: 'notified',
      content: 'done',
    })
    expect(history.saveSourceResult).not.toHaveBeenCalled()
    expect(deps.onHistoryError).toHaveBeenCalledTimes(2)
  })

  it('shows the result when the insert fails', async () => {
    const { history, execution } = setup({
      run: vi.fn(async () => runResult({ effectiveOutputAction: 'insert' })),
      getInsert: () => vi.fn(async () => Promise.reject(new Error('gone'))),
    })
    expect(await execution.execute(task, 'text')).toEqual({
      kind: 'show',
      content: 'done',
      wasFocusGuardTriggered: false,
      wasInsertFailed: true,
    })
    expect(history.saveOutput).not.toHaveBeenCalled()
  })

  it('tells a cancellation from a failure', async () => {
    const error = new Error('boom')
    const { execution } = setup({
      run: vi.fn(async () => Promise.reject(error)),
    })
    expect(await execution.execute(task, 'text')).toEqual({
      kind: 'failed',
      error,
    })

    const controller = new AbortController()
    controller.abort()
    expect(
      await execution.execute(task, 'text', { signal: controller.signal })
    ).toEqual({ kind: 'cancelled' })
  })
})
