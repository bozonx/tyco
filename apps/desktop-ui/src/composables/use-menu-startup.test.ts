import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useMenuStartup } from './use-menu-startup'

function mountMenu(deps: Parameters<typeof useMenuStartup>[0]) {
  return mount(
    defineComponent({
      setup() {
        useMenuStartup(deps)
        return () => null
      },
    })
  )
}

describe('menu startup', () => {
  it('does nothing without a startup parameter', () => {
    const consume = vi.fn()
    const run = vi.fn(async () => {})
    mountMenu({ getValue: () => undefined, consume, run })
    expect(consume).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('consumes the parameter before running and does not repeat it on remount', () => {
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
    mountMenu(deps).unmount()
    mountMenu(deps)
    expect(run).toHaveBeenCalledOnce()
  })
})
