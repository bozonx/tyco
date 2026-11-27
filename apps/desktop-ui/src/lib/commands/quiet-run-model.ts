import { errorMessage } from '@tyco/shared/value-guards'
import type { CommandConfig, QuietRunEvent } from '@tyco/shared'

import { type CommandRunSessionDependencies } from './command-run-session'
import { normalizeCommands } from './command-config'
import { commandRunRecord, logCommandRun } from './command-run-record'
import type {
  InvocationOptions,
  InvocationOutcome,
} from '../invocation/invocation-types'

type QuietRunDependencies = Pick<
  CommandRunSessionDependencies,
  | 'claim'
  | 'finish'
  | 'takesText'
  | 'logRun'
  | 'reportError'
  | 'applyUserConfig'
> & {
  run: (
    command: CommandConfig,
    text: string,
    options: InvocationOptions
  ) => Promise<InvocationOutcome>
}

export function createQuietRunModel(deps: QuietRunDependencies) {
  let active: { id: string; controller: AbortController } | undefined

  const run = async ({ jobId }: QuietRunEvent) => {
    if (active?.id === jobId) return
    active?.controller.abort()
    const controller = new AbortController()
    active = { id: jobId, controller }
    try {
      const payload = await deps.claim(jobId)
      if (!payload || controller.signal.aborted) return
      deps.applyUserConfig?.(payload.userConfig)
      const command = normalizeCommands(payload.userConfig.commands).find(
        (item) => item.id === payload.commandId
      )
      if (!command) {
        await deps.finish(jobId, {
          success: false,
          message: 'Command is unavailable',
        })
        return
      }
      let outcome: InvocationOutcome
      if (
        payload.text == null &&
        payload.input == null &&
        deps.takesText(command)
      ) {
        outcome = {
          success: false,
          code: 'InputRequired',
          message: 'This command requires input',
        }
      } else {
        outcome = await deps.run(command, payload.text ?? '', {
          source: 'external',
          output: 'return',
          input: payload.input,
          signal: controller.signal,
          isQuiet: true,
        })
      }
      const final = (await deps.finish(jobId, outcome)) ?? outcome
      if (!final.cancelled || final.code === 'TimedOut')
        logCommandRun(
          deps,
          commandRunRecord(command, 'external', payload.text ?? null, final)
        )
    } catch (error) {
      deps.reportError?.(error)
      await deps.finish(jobId, { success: false, message: errorMessage(error) })
    } finally {
      if (active?.id === jobId) active = undefined
    }
  }

  return {
    run,
    abort(id: string) {
      if (active?.id === id) active.controller.abort()
    },
    dispose() {
      active?.controller.abort()
    },
  }
}
