import { describe, expect, it, vi } from 'vitest'
import type { ScriptActionRequest } from '@tyco/shared'
import type { DesktopCall } from '../ipc/ipc-model'
import { createScriptActionClient } from './script-action-client'

const request: ScriptActionRequest = {
  commandId: 'test',
  text: '',
  captureOutput: true,
  logOutput: false,
}

describe('script action client', () => {
  it('forwards execution and cancellation requests', async () => {
    const result = { success: true, exitCode: 0, stdout: 'test', stderr: '' }
    const call = vi
      .fn()
      .mockResolvedValueOnce({ success: true, result })
      .mockResolvedValueOnce({ success: true, result: true })
    const client = createScriptActionClient(call as DesktopCall)
    expect(await client.executeScriptAction(request)).toBe(result)
    expect(call).toHaveBeenNthCalledWith(1, 'execute_script_action', {
      request,
    })
    expect(await client.cancelScriptAction('run-1')).toBe(true)
    expect(call).toHaveBeenNthCalledWith(2, 'cancel_script_action', {
      runId: 'run-1',
    })
  })

  it.each([
    [{ success: false, error: 'Backend failed' }, 'Backend failed'],
    [{ success: true }, 'Empty response'],
  ])(
    'rejects unsuccessful or empty execution responses',
    async (response, message) => {
      const client = createScriptActionClient(
        vi.fn().mockResolvedValue(response) as DesktopCall
      )
      await expect(client.executeScriptAction(request)).rejects.toThrow(message)
    }
  )

  it.each([
    { success: false, result: true },
    { success: true, result: false },
    { success: true },
  ])('does not acknowledge unsuccessful cancellation', async (response) => {
    const client = createScriptActionClient(
      vi.fn().mockResolvedValue(response) as DesktopCall
    )
    expect(await client.cancelScriptAction('run-1')).toBe(false)
  })
})
