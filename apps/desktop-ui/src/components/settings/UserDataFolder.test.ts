import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import UserDataFolder from './UserDataFolder.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

describe('UserDataFolder.vue', () => {
  let desktop: TestDesktop | undefined

  afterEach(() => {
    desktop?.dispose()
    desktop = undefined
  })

  async function mountSection(isDefault = false) {
    desktop = await loadFakeDesktop({
      userData: {
        path: isDefault ? '/home/u/.local/share/com.tyco.app' : '/sync/TyCo',
        defaultPath: '/home/u/.local/share/com.tyco.app',
        isDefault,
        status: 'connected',
        isWritableByOthers: false,
        deviceId: 'device-1',
        platform: 'linux',
      },
    })
    const wrapper = mount(UserDataFolder, {
      global: {
        plugins: [desktop.pinia],
        stubs: {
          BaseDialog: {
            props: ['open', 'labelledby'],
            emits: ['close'],
            template: '<div v-if="open" class="dialog-stub"><slot /></div>',
          },
          InfoTooltip: {
            props: ['text'],
            template: '<span class="info-tooltip-stub" :data-text="text" />',
          },
        },
      },
    })
    return { desktop, wrapper }
  }

  it('shows copy, open and change actions without a default badge', async () => {
    const { wrapper } = await mountSection(true)

    expect(wrapper.get('.info-tooltip-stub').attributes('data-text')).toBe(
      'settings.userData.info:{"defaultPath":"/home/u/.local/share/com.tyco.app"}'
    )
    expect(wrapper.find('.badge').exists()).toBe(false)
    expect(wrapper.find('.advanced-toggle').exists()).toBe(false)

    const actionButtons = wrapper.findAll('.user-data-path-actions button')
    expect(actionButtons).toHaveLength(3)
    expect(actionButtons[0].attributes('aria-label')).toBe(
      'settings.storageCopyPath'
    )
    expect(actionButtons[1].text()).toContain('common.open')
    expect(actionButtons[2].text()).toContain('common.change')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('picks a folder immediately and opens the confirmation modal with move or connect', async () => {
    const { desktop: d, wrapper } = await mountSection(true)
    d.backend.handle('pick_directory', () => '/sync/TyCo')
    d.backend.handle('inspect_user_data_target', ({ path }) => ({
      path: path ?? '/sync/TyCo',
      isDefault: false,
      contents: { kind: 'userData', formatVersion: 1, isSupported: true },
    }))
    d.backend.handle('relocate_user_data', () => undefined)

    const actionButtons = wrapper.findAll('.user-data-path-actions button')
    await actionButtons[2].trigger('click')
    await flushPromises()

    const dialog = wrapper.get('.dialog-stub')
    expect(dialog.text()).toContain('settings.userData.connectTitle')
    expect(dialog.text()).toContain('settings.userData.applyConnect')

    await dialog.get('button.btn-primary').trigger('click')
    await flushPromises()
    expect(d.backend.callsOf('relocate_user_data')).toEqual([
      { mode: 'connect', path: '/sync/TyCo' },
    ])
  })
})
