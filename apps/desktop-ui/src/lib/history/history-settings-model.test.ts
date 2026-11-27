import { describe, expect, it } from 'vitest'

import {
  type KeptHistoryConfig,
  createHistoryKeepingModel,
  historyKeepingChoice,
  historyKeepingOptions,
} from './history-settings-model'

function setup(history: KeptHistoryConfig) {
  const model = createHistoryKeepingModel({
    getHistory: () => history,
    retentionMessage: (days) => `Delete older than ${days}`,
  })
  return { history, model }
}

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

  it('turns the history off or keeps it in memory without asking', () => {
    const { history, model } = setup({ storage: 'disk', retentionDays: 30 })
    model.setKeeping('off')
    expect(model.pendingChange.value).toBeNull()
    expect(history).toEqual({ storage: 'off', retentionDays: 30 })
    model.setKeeping('session')
    expect(model.pendingChange.value).toBeNull()
    expect(history.storage).toBe('session')
  })

  it('waits for confirmation before shortening the retention', () => {
    const { history, model } = setup({ storage: 'disk', retentionDays: 30 })
    model.setKeeping(7)
    expect(history.retentionDays).toBe(30)
    expect(model.pendingChange.value?.message).toBe('Delete older than 7')
    model.cancelChange()
    model.confirmChange()
    expect(history.retentionDays).toBe(30)
    model.setKeeping(7)
    model.confirmChange()
    expect(history).toEqual({ storage: 'disk', retentionDays: 7 })
  })

  it('extends the retention at once and keeps forever as no field', () => {
    const { history, model } = setup({ storage: 'off', retentionDays: 7 })
    model.setKeeping(90)
    expect(history).toEqual({ storage: 'disk', retentionDays: 90 })
    model.setKeeping(0)
    expect(history).toEqual({ storage: 'disk' })
  })

  it.each([undefined, '', 'wrong', -1, 0.5, Infinity])(
    'ignores the invalid choice %s',
    (value) => {
      const { history, model } = setup({ storage: 'disk', retentionDays: 30 })
      model.setKeeping(value as string)
      expect(history).toEqual({ storage: 'disk', retentionDays: 30 })
      expect(model.pendingChange.value).toBeNull()
    }
  )
})
