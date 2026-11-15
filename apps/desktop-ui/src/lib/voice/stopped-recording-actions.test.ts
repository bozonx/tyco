import { describe, expect, it } from 'vitest'

import { stoppedRecordingActions } from './stopped-recording-actions'

describe('stoppedRecordingActions', () => {
  it('makes retry primary and lists the rest least important first', () => {
    expect(
      stoppedRecordingActions({
        canRetry: true,
        canTypeText: true,
        canOpenSettings: true,
      })
    ).toEqual({ primary: 'retry', others: ['openSettings', 'typeText'] })
  })

  it('promotes typing the text when a retry cannot help', () => {
    expect(
      stoppedRecordingActions({
        canRetry: false,
        canTypeText: true,
        canOpenSettings: true,
      })
    ).toEqual({ primary: 'typeText', others: ['openSettings'] })
  })

  it('promotes the settings when nothing else is left', () => {
    expect(
      stoppedRecordingActions({ canRetry: false, canOpenSettings: true })
    ).toEqual({ primary: 'openSettings', others: [] })
  })

  it('has no primary action when nothing is available', () => {
    expect(
      stoppedRecordingActions({ canRetry: false, canOpenSettings: false })
    ).toEqual({ primary: undefined, others: [] })
  })
})
