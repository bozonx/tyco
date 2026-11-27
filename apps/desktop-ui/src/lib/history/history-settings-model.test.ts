import { describe, expect, it } from 'vitest'

import {
  type KeptHistoryConfig,
  applyHistoryKeeping,
  historyKeepingChoice,
  historyKeepingOptions,
} from './history-settings-model'

describe('history keeping', () => {
  it('reads one choice from the storage and the retention', () => {
    expect(historyKeepingChoice({ storage: 'session', retentionDays: 7 })).toBe(
      'session'
    )
    expect(historyKeepingChoice({ storage: 'disk', retentionDays: 7 })).toBe(7)
    expect(historyKeepingChoice({ storage: 'disk' })).toBe(0)
  })

  it('lists the session, the periods and forever last', () => {
    const options = historyKeepingOptions([0, 1, 7], {
      session: 'Session',
      forever: 'Forever',
      period: (days) => `${days} d`,
    })
    expect(options.map(({ id }) => id)).toEqual(['session', 1, 7, 0])
  })

  it('applies every choice at once and keeps forever as no field', () => {
    const history: KeptHistoryConfig = { storage: 'disk', retentionDays: 30 }
    expect(applyHistoryKeeping(history, 'session')).toBe(true)
    expect(history).toEqual({ storage: 'session', retentionDays: 30 })
    applyHistoryKeeping(history, 7)
    expect(history).toEqual({ storage: 'disk', retentionDays: 7 })
    applyHistoryKeeping(history, 0)
    expect(history).toEqual({ storage: 'disk' })
  })

  it.each([undefined, '', 'off', -1, 0.5, Infinity])(
    'ignores the invalid choice %s',
    (value) => {
      const history: KeptHistoryConfig = { storage: 'disk', retentionDays: 30 }
      expect(applyHistoryKeeping(history, value as string)).toBe(false)
      expect(history).toEqual({ storage: 'disk', retentionDays: 30 })
    }
  )
})
