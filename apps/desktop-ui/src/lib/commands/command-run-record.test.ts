import { describe, expect, it, vi } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { createCommand } from './command-config'
import { commandRunRecord, logCommandRun } from './command-run-record'

const lamp: CommandConfig = {
  ...createCommand('webhook', 'lamp'),
  name: 'Lamp',
}

describe('commandRunRecord', () => {
  it('records the input and the message when there are any', () => {
    expect(
      commandRunRecord(lamp, 'menu', 'text', {
        success: false,
        message: 'Down',
      })
    ).toEqual({
      commandId: 'lamp',
      name: 'Lamp',
      source: 'menu',
      text: 'text',
      success: false,
      message: 'Down',
    })
  })

  it('leaves out a missing input and an empty message', () => {
    expect(
      commandRunRecord(lamp, 'external', null, { success: true, message: '' })
    ).toEqual({
      commandId: 'lamp',
      name: 'Lamp',
      source: 'external',
      success: true,
    })
  })
})

describe('logCommandRun', () => {
  const record = commandRunRecord(lamp, 'voice', 'text', { success: true })

  it('reports a rejected log', async () => {
    const error = new Error('down')
    const reportError = vi.fn()
    logCommandRun({ logRun: () => Promise.reject(error), reportError }, record)
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(error))
  })

  it('reports a log that throws at once instead of throwing', async () => {
    const error = new Error('down')
    const reportError = vi.fn()
    expect(() =>
      logCommandRun(
        {
          logRun: () => {
            throw error
          },
          reportError,
        },
        record
      )
    ).not.toThrow()
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(error))
  })
})
