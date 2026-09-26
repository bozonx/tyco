import { describe, expect, it, vi } from 'vitest'

import {
  createInputRegionSync,
  inputRegion,
  sameRegion,
  unionRect,
  type InputRect,
} from './input-region'

const viewport = { width: 800, height: 500 }

describe('unionRect', () => {
  it('has nothing to cover without rectangles', () => {
    expect(unionRect([])).toBeNull()
  })

  it('covers the input and the hint below it', () => {
    expect(
      unionRect([
        { x: 8, y: 420, width: 784, height: 40 },
        { x: 8, y: 468, width: 300, height: 24 },
      ])
    ).toEqual({ x: 8, y: 420, width: 784, height: 72 })
  })
})

describe('inputRegion', () => {
  it('grows the content by the margin', () => {
    expect(
      inputRegion({ x: 20, y: 400, width: 700, height: 60 }, viewport, 8)
    ).toEqual({ x: 12, y: 392, width: 716, height: 76 })
  })

  it('stays inside the window', () => {
    expect(
      inputRegion({ x: 4, y: 2, width: 796, height: 497 }, viewport, 8)
    ).toEqual({ x: 0, y: 0, width: 800, height: 500 })
  })

  it('rounds outwards so fractional edges stay clickable', () => {
    expect(
      inputRegion(
        { x: 10.4, y: 400.6, width: 100.2, height: 20.1 },
        viewport,
        0
      )
    ).toEqual({ x: 10, y: 400, width: 101, height: 21 })
  })

  it('gives the whole window back without visible content', () => {
    expect(inputRegion(null, viewport)).toBeNull()
    expect(
      inputRegion({ x: 0, y: 0, width: 0, height: 0 }, viewport)
    ).toBeNull()
    expect(
      inputRegion({ x: 900, y: 600, width: 10, height: 10 }, viewport, 0)
    ).toBeNull()
  })
})

describe('sameRegion', () => {
  it('compares by value', () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 }
    expect(sameRegion(rect, { ...rect })).toBe(true)
    expect(sameRegion(rect, { ...rect, height: 5 })).toBe(false)
    expect(sameRegion(null, null)).toBe(true)
    expect(sameRegion(rect, null)).toBe(false)
  })
})

describe('createInputRegionSync', () => {
  const a: InputRect = { x: 0, y: 400, width: 800, height: 100 }
  const b: InputRect = { x: 0, y: 300, width: 800, height: 200 }

  function deferredApply() {
    const calls: Array<{
      region: InputRect | null
      resolve: () => void
      reject: () => void
    }> = []
    const apply = vi.fn(
      (region: InputRect | null) =>
        new Promise<void>((resolve, reject) => {
          calls.push({ region, resolve, reject })
        })
    )
    const settle = async (index: number, ok = true) => {
      if (ok) calls[index].resolve()
      else calls[index].reject()
      // let the sync loop run to its next request
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { apply, calls, settle }
  }

  it('skips a region equal to the applied one', async () => {
    const apply = vi.fn(async () => {})
    const sync = createInputRegionSync({ apply })

    await sync.update(a)
    await sync.update({ ...a })

    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('collapses updates made during a request into the latest one', async () => {
    const { apply, calls, settle } = deferredApply()
    const sync = createInputRegionSync({ apply })

    void sync.update(a)
    void sync.update(b)
    void sync.update(null)
    await settle(0)
    await settle(1)

    expect(calls.map((call) => call.region)).toEqual([a, null])
  })

  it('sends the region again after the window system reset it', async () => {
    const apply = vi.fn(async () => {})
    const sync = createInputRegionSync({ apply })

    await sync.update(a)
    sync.invalidate()
    await sync.update(a)

    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('repeats a request that was in flight across a reset', async () => {
    const { apply, calls, settle } = deferredApply()
    const sync = createInputRegionSync({ apply })

    void sync.update(a)
    sync.invalidate()
    await settle(0)
    await settle(1)

    expect(calls.map((call) => call.region)).toEqual([a, a])
  })

  it('retries a failed region on the next update', async () => {
    const { apply, calls, settle } = deferredApply()
    const sync = createInputRegionSync({ apply })

    void sync.update(a)
    await settle(0, false)
    void sync.update(a)
    await settle(1)

    expect(calls).toHaveLength(2)
  })

  it('sends nothing after dispose', async () => {
    const apply = vi.fn(async () => {})
    const sync = createInputRegionSync({ apply })

    sync.dispose()
    await sync.update(a)

    expect(apply).not.toHaveBeenCalled()
  })
})
