import { describe, expect, it } from 'vitest'

import { createSoundCaptureActivity } from './sound-capture-activity'

function setup() {
  const changes: boolean[] = []
  const timers = new Map<number, () => void>()
  let nextId = 0
  const activity = createSoundCaptureActivity({
    onChange: (isActive) => changes.push(isActive),
    setTimeout: (callback) => {
      nextId += 1
      timers.set(nextId, callback)
      return nextId
    },
    clearTimeout: (handle) => timers.delete(handle as number),
  })
  const elapse = () => {
    for (const [id, callback] of [...timers]) {
      timers.delete(id)
      callback()
    }
  }
  return { activity, changes, timers, elapse }
}

describe('createSoundCaptureActivity', () => {
  it('is active from the first level until the levels stop', () => {
    const { activity, changes, timers, elapse } = setup()
    expect(activity.isActive).toBe(false)
    activity.onLevel()
    activity.onLevel()
    expect(activity.isActive).toBe(true)
    expect(changes).toEqual([true])
    expect(timers.size).toBe(1)
    elapse()
    expect(activity.isActive).toBe(false)
    expect(changes).toEqual([true, false])
  })

  it('stops its timer when disposed', () => {
    const { activity, timers } = setup()
    activity.onLevel()
    activity.dispose()
    expect(timers.size).toBe(0)
  })
})
