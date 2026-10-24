import { describe, expect, it, vi } from 'vitest'

import { runMenuStartup } from './menu-startup'

describe('menu startup', () => {
  it('does nothing without a startup parameter', () => {
    const consume = vi.fn()
    const run = vi.fn(async () => {})
    expect(
      runMenuStartup({ getValue: () => undefined, consume, run })
    ).toBeUndefined()
    expect(consume).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('consumes the parameter before starting so returning to the step does not repeat it', async () => {
    let value: string | undefined = 'task'
    const run = vi.fn(async (submitted: string) => {
      expect(submitted).toBe('task')
      expect(value).toBeUndefined()
    })
    const deps = {
      getValue: () => value,
      consume: () => {
        value = undefined
      },
      run,
    }
    await runMenuStartup(deps)
    await runMenuStartup(deps)
    expect(run).toHaveBeenCalledOnce()
  })
})
