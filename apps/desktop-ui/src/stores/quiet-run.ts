import { defineStore } from 'pinia'
import { onScopeDispose, shallowRef } from 'vue'

import type { QuietRunEvent } from '@tyco/shared'

import { createCommandRunner } from '../lib/commands/command-runner'
import { commandTakesText } from '../lib/commands/command-runtime'
import { createExternalJobAdapter } from '../lib/commands/external-job-adapter'
import { createQuietRunModel } from '../lib/commands/quiet-run-model'
import { resultOrThrow } from '../lib/ipc/ipc-model'
import { clientLogger } from '../lib/logger'
import { useDesktopStore } from './desktop'
import { useInvocationRunnerDependencies } from './invocations'
import { useIpcStore } from './ipc'
import { useOperationsStore } from './operations'

export const useQuietRunStore = defineStore('quietRun', () => {
  const status = shallowRef<QuietRunEvent>()
  const completion = shallowRef<QuietRunEvent>()
  const cancellingJobId = shallowRef<string>()
  let clearTimer: ReturnType<typeof setTimeout> | undefined
  let dispose: (() => void) | undefined
  let handleExecution: ((event: QuietRunEvent) => void) | undefined

  const clearCompletionOnFocus = () => {
    if (!completion.value || !document.hasFocus()) return
    clearTimeout(clearTimer)
    clearTimer = setTimeout(() => (completion.value = undefined), 5000)
  }
  window.addEventListener('focus', clearCompletionOnFocus)

  const ipc = useIpcStore()
  const reportError = (error: unknown) =>
    clientLogger.error('Quiet command run failed', error, 'command-run')

  const startExecutor = () => {
    if (handleExecution) return
    const desktop = useDesktopStore()
    const operations = useOperationsStore()
    const jobs = createExternalJobAdapter({ call: ipc.call, reportError })
    const runner = createCommandRunner({
      ...useInvocationRunnerDependencies(),
      showToast: () => {},
    })
    const model = createQuietRunModel({
      claim: jobs.claimJob,
      finish: jobs.finishJob,
      run: runner.run,
      takesText: (command) => commandTakesText(command, operations),
      applyUserConfig: desktop.setExecutionConfig,
      logRun: async (record) => {
        resultOrThrow(await ipc.call('log_command_run', { record }))
      },
      reportError,
    })
    handleExecution = (event) => {
      if (event.state === 'accepted') void model.run(event).catch(reportError)
      else if (event.state !== 'running') model.abort(event.jobId)
    }
    dispose = model.dispose
  }

  const update = (event: QuietRunEvent) => {
    handleExecution?.(event)
    const isActive = event.state === 'accepted' || event.state === 'running'
    if (isActive) {
      status.value = event
      return
    }
    if (status.value?.jobId === event.jobId) status.value = undefined
    if (cancellingJobId.value === event.jobId) cancellingJobId.value = undefined
    clearTimeout(clearTimer)
    completion.value = event
    clearCompletionOnFocus()
  }

  const refresh = async () => {
    const previous = status.value
    const result = await ipc.call('get_quiet_run_status')
    if (result.success && result.result && previous === status.value)
      update(result.result)
  }

  onScopeDispose(() => {
    clearTimeout(clearTimer)
    window.removeEventListener('focus', clearCompletionOnFocus)
    dispose?.()
  })

  return {
    status,
    completion,
    cancellingJobId,
    startExecutor,
    refresh,
    update,
    async cancel(id: string) {
      if (cancellingJobId.value === id) return
      cancellingJobId.value = id
      const result = await ipc.callOrNotify('cancel_external_job', { id })
      if (!result.success && cancellingJobId.value === id)
        cancellingJobId.value = undefined
    },
  }
})
