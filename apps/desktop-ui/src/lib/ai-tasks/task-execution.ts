import type { AiTaskConfig } from '@tyco/shared'

import type { TaskRunOptions, TaskRunResult } from './task-runner'

export interface TaskExecutionHistory {
  saveSource: (text: string, operation: 'aiTask') => Promise<string | null>
  saveSourceResult: (sourceId: string, result: string) => Promise<unknown>
  saveOutput: (text: string) => Promise<unknown>
}

export interface TaskExecutionDependencies {
  run: (
    task: AiTaskConfig,
    text: string,
    options: TaskRunOptions
  ) => Promise<TaskRunResult>
  history: TaskExecutionHistory
  /** Inserts into the target window; absent when no target can take it */
  getInsert: () => ((text: string) => Promise<unknown>) | undefined
  /** History is a side record: its failures are reported, never fatal */
  onHistoryError: (error: unknown) => void
}

export type TaskExecutionOutcome =
  | { kind: 'empty' }
  | { kind: 'inserted' }
  | { kind: 'notified'; content: string }
  | { kind: 'show'; content: string; wasFocusGuardTriggered: boolean }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: unknown }

/** Runs an AI task and carries out its output action */
export function createTaskExecution(deps: TaskExecutionDependencies) {
  const record = async (write: () => Promise<unknown>) => {
    try {
      await write()
    } catch (error) {
      deps.onHistoryError(error)
    }
  }

  const execute = async (
    task: AiTaskConfig,
    text: string,
    options: TaskRunOptions = {}
  ): Promise<TaskExecutionOutcome> => {
    const trimmed = text.trim()
    if (!trimmed) return { kind: 'empty' }

    let sourceId: string | null = null
    await record(async () => {
      sourceId = await deps.history.saveSource(trimmed, 'aiTask')
    })

    let result: TaskRunResult
    try {
      result = await deps.run(task, trimmed, options)
    } catch (error) {
      if (options.signal?.aborted) return { kind: 'cancelled' }
      return { kind: 'failed', error }
    }

    const { content } = result
    const id: string | null = sourceId
    if (id && content) {
      await record(() => deps.history.saveSourceResult(id, content))
    }

    switch (result.effectiveOutputAction) {
      case 'replace':
      case 'insert': {
        const insert = deps.getInsert()
        // the target was lost or the focus guard fired: show it instead
        if (!insert) {
          return { kind: 'show', content, wasFocusGuardTriggered: true }
        }
        try {
          await insert(content)
        } catch (error) {
          return { kind: 'failed', error }
        }
        await record(() => deps.history.saveOutput(content))
        return { kind: 'inserted' }
      }
      case 'notify_and_close':
        await record(() => deps.history.saveOutput(content))
        return { kind: 'notified', content }
      default:
        return {
          kind: 'show',
          content,
          wasFocusGuardTriggered: result.wasFocusGuardTriggered,
        }
    }
  }

  return { execute }
}
