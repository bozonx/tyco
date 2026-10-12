import { describe, expect, it, vi } from 'vitest'

import type { DesktopCall } from '../ipc/desktop-functions'
import { createExternalJobAdapter } from './external-job-adapter'

describe('external job adapter', () => {
  it('claims only confirmed jobs', async () => {
    const callFunction = vi
      .fn<DesktopCall>()
      .mockResolvedValueOnce({ success: false, error: 'Unavailable' })
      .mockResolvedValueOnce({ success: true, result: false })
      .mockResolvedValueOnce({ success: true, result: true })
    const adapter = createExternalJobAdapter({
      callFunction: callFunction as DesktopCall,
    })
    expect(await adapter.claimJob('job')).toBe(false)
    expect(await adapter.claimJob('job')).toBe(false)
    expect(await adapter.claimJob('job')).toBe(true)
    expect(callFunction).toHaveBeenCalledWith('claimExternalJob', ['job'])
  })

  it('preserves completion when no job is returned and propagates IPC failures', async () => {
    const callFunction = vi
      .fn<DesktopCall>()
      .mockResolvedValueOnce({ success: true, result: null })
      .mockResolvedValueOnce({ success: false, error: 'Unavailable' })
    const adapter = createExternalJobAdapter({
      callFunction: callFunction as DesktopCall,
    })
    const completion = { success: true, output: 'Output' }
    expect(await adapter.finishJob('job', completion)).toBe(completion)
    expect(await adapter.finishJob('job', completion)).toEqual({
      success: false,
      message: 'Unavailable',
    })
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
      const callFunction = vi
        .fn<DesktopCall>()
        .mockResolvedValue({ success: true, result: job })
      const selectionFailed = vi.fn()
      const adapter = createExternalJobAdapter({
        callFunction: callFunction as DesktopCall,
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
