import { describe, expect, it, vi } from 'vitest'

import type { DesktopCall } from '../ipc/ipc-model'
import { createExternalJobAdapter } from './external-job-adapter'

describe('external job adapter', () => {
  it('claims only confirmed jobs', async () => {
    const call = vi
      .fn<DesktopCall>()
      .mockResolvedValueOnce({ success: false, error: 'Unavailable' })
      .mockResolvedValueOnce({ success: true, result: false })
      .mockResolvedValueOnce({ success: true, result: true })
    const adapter = createExternalJobAdapter({ call: call as DesktopCall })
    expect(await adapter.claimJob('job')).toBe(false)
    expect(await adapter.claimJob('job')).toBe(false)
    expect(await adapter.claimJob('job')).toBe(true)
    expect(call).toHaveBeenCalledWith('claim_external_job', { id: 'job' })
  })

  it('preserves completion when no job is returned or finishing fails', async () => {
    const call = vi
      .fn<DesktopCall>()
      .mockResolvedValueOnce({ success: true, result: null })
      .mockResolvedValueOnce({ success: false, error: 'Unavailable' })
    const reportError = vi.fn()
    const adapter = createExternalJobAdapter({
      call: call as DesktopCall,
      reportError,
    })
    const completion = { success: true, output: 'Output' }
    expect(await adapter.finishJob('job', completion)).toBe(completion)
    expect(await adapter.finishJob('job', completion)).toBe(completion)
    expect(reportError).toHaveBeenCalledWith(new Error('Unavailable'))
  })

  it.each(['succeeded', 'cancelled', 'failed'] as const)(
    'maps %s jobs and reports selection failures',
    async (state) => {
      const job = {
        id: 'job',
        commandId: 'command',
        state,
        output: 'Output',
        error: 'Insertion failed',
        code: state === 'failed' ? 'SelectionFailed' : undefined,
      }
      const call = vi
        .fn<DesktopCall>()
        .mockResolvedValue({ success: true, result: job })
      const selectionFailed = vi.fn()
      const adapter = createExternalJobAdapter({
        call: call as DesktopCall,
        selectionFailed,
      })
      expect(await adapter.finishJob('job', { success: true })).toEqual({
        success: state === 'succeeded',
        cancelled: state === 'cancelled',
        output: job.output,
        message: job.error,
        code: job.code,
      })
      expect(selectionFailed).toHaveBeenCalledTimes(state === 'failed' ? 1 : 0)
    }
  )
})
