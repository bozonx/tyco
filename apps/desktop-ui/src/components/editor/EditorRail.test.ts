import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import EditorRail from './EditorRail.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const state = reactive({
  userConfig: { ...DEFAULT_USER_CONFIG, isInDevelopment: false },
})

vi.mock('../../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../../test/desktop-store')
  return {
    useDesktopStore: () => mockDesktopStore(() => state),
  }
})

describe('EditorRail.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    state.userConfig.isInDevelopment = false
  })

  it('hides correction button when not in development mode', () => {
    const wrapper = mount(EditorRail, {
      props: { compact: false },
      global: {
        stubs: {
          IconButton: {
            props: ['label', 'icon'],
            template: '<button :aria-label="label" :data-icon="icon" />',
          },
          InfoTooltip: true,
        },
      },
    })
    expect(wrapper.find('button[data-icon="mdi:auto-fix"]').exists()).toBe(false)
  })

  it('shows correction button when in development mode', () => {
    state.userConfig.isInDevelopment = true
    const wrapper = mount(EditorRail, {
      props: { compact: false },
      global: {
        stubs: {
          IconButton: {
            props: ['label', 'icon'],
            template: '<button :aria-label="label" :data-icon="icon" />',
          },
          InfoTooltip: true,
        },
      },
    })
    expect(wrapper.find('button[data-icon="mdi:auto-fix"]').exists()).toBe(true)
  })
})
