import { describe, expect, it, vi } from 'vitest'

import { createHistorySettingsModel } from './history-settings-model'

function setup(retentionDays: number | undefined = 30) {
  const deps = {
    getRetentionDays: () => retentionDays,
    setRetentionDays: vi.fn((days: number | undefined) => {
      retentionDays = days
    }),
    retentionMessage: (days: number) => `Delete older than ${days}`,
  }
  return { deps, model: createHistorySettingsModel(deps) }
}

describe('history settings', () => {
  it('waits for confirmation before shortening retention', () => {
    const { deps, model } = setup()
    model.setRetentionDays(7)
    expect(deps.setRetentionDays).not.toHaveBeenCalled()
    model.cancelChange()
    model.confirmChange()
    expect(deps.setRetentionDays).not.toHaveBeenCalled()
    model.setRetentionDays(7)
    model.confirmChange()
    expect(deps.setRetentionDays).toHaveBeenCalledWith(7)
    expect(model.pendingChange.value).toBeNull()
  })

  it('extends retention immediately and represents forever as undefined', () => {
    const { deps, model } = setup()
    model.setRetentionDays(90)
    model.setRetentionDays(0)
    expect(deps.setRetentionDays.mock.calls).toEqual([[90], [undefined]])
    model.setRetentionDays(7)
    expect(model.pendingChange.value?.message).toBe('Delete older than 7')
  })

  it('cancels a previous pending change when replacing it', () => {
    const { model } = setup()
    const cancel = vi.fn()
    const apply = vi.fn()
    model.requestChange({ message: 'Limit', apply, cancel })
    model.setRetentionDays(7)
    expect(cancel).toHaveBeenCalledOnce()
    model.confirmChange()
    expect(apply).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'wrong', -1, 0.5, Infinity])(
    'ignores invalid days %s',
    (days) => {
      const { deps, model } = setup()
      model.setRetentionDays(days)
      expect(deps.setRetentionDays).not.toHaveBeenCalled()
      expect(model.pendingChange.value).toBeNull()
    }
  )
})
