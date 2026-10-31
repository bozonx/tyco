import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import EditorRail from './EditorRail.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('EditorRail.vue', () => {
  let desktop: TestDesktop

  afterEach(() => desktop.dispose())

  async function mountRail(isInDevelopment: boolean) {
    desktop = installFakeDesktop({
      userConfig: { ...DEFAULT_USER_CONFIG, isInDevelopment },
    })
    await desktop.load()
    return mount(EditorRail, {
      props: { compact: false },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          IconButton: {
            props: ['label', 'icon'],
            template: '<button :aria-label="label" :data-icon="icon" />',
          },
          InfoTooltip: true,
        },
      },
    })
  }

  it('hides correction button when not in development mode', async () => {
    const wrapper = await mountRail(false)
    expect(wrapper.find('button[data-icon="mdi:spellcheck"]').exists()).toBe(
      false
    )
  })

  it('shows correction button when in development mode', async () => {
    const wrapper = await mountRail(true)
    expect(wrapper.find('button[data-icon="mdi:spellcheck"]').exists()).toBe(
      true
    )
  })
})
