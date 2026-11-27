import { describe, expect, it } from 'vitest'

import {
  type KeptHistoryConfig,
  applyHistoryKeeping,
  historyKeepingChoice,
  historyKeepingOptions,
} from './history-settings-model'

describe('history keeping', () => {
  it('reads one choice from the storage and the retention', () => {
    expect(historyKeepingChoice({ storage: 'off', retentionDays: 7 })).toBe(
      'off'
    )
    expect(historyKeepingChoice({ storage: 'session' })).toBe('session')
    expect(historyKeepingChoice({ storage: 'disk', retentionDays: 7 })).toBe(7)
    expect(historyKeepingChoice({ storage: 'disk' })).toBe(0)
  })

  it('lists off, the session, the periods and forever last', () => {
    const options = historyKeepingOptions([0, 1, 7], {
      off: 'Off',
      session: 'Session',
      forever: 'Forever',
      period: (days) => `${days} d`,
    })
    expect(options.map(({ id }) => id)).toEqual(['off', 'session', 1, 7, 0])
    expect(
      historyKeepingOptions([7], {
        off: 'Off',
        forever: 'Forever',
        period: String,
      }).map(({ id }) => id)
    ).toEqual(['off', 7, 0])
  })

  it('applies every choice at once and keeps forever as no field', () => {
    const history: KeptHistoryConfig = { storage: 'disk', retentionDays: 30 }
    expect(applyHistoryKeeping(history, 'off')).toBe(true)
    expect(history).toEqual({ storage: 'off', retentionDays: 30 })
    applyHistoryKeeping(history, 'session')
    expect(history.storage).toBe('session')
    applyHistoryKeeping(history, 7)
    expect(history).toEqual({ storage: 'disk', retentionDays: 7 })
    applyHistoryKeeping(history, 0)
    expect(history).toEqual({ storage: 'disk' })
  })

  it.each([undefined, '', 'wrong', -1, 0.5, Infinity])(
    'ignores the invalid choice %s',
    (value) => {
      const history: KeptHistoryConfig = { storage: 'disk', retentionDays: 30 }
      expect(applyHistoryKeeping(history, value as string)).toBe(false)
      expect(history).toEqual({ storage: 'disk', retentionDays: 30 })
    }
  )
})
