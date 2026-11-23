import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import UserDataMissingScreen from './UserDataMissingScreen.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

describe('UserDataMissingScreen.vue', () => {
  let desktop: TestDesktop | undefined

  afterEach(() => {
    desktop?.dispose()
    desktop = undefined
  })

  it('shows the first-start setup screen with select folder and start fresh buttons', async () => {
    desktop = await loadFakeDesktop({
      userData: {
        path: '/home/u/.local/share/com.tyco.app',
        defaultPath: '/home/u/.local/share/com.tyco.app',
        isDefault: true,
        status: 'notInitialized',
        isWritableByOthers: false,
        deviceId: 'device-1',
        platform: 'linux',
      },
    })
    desktop.backend.handle('relocate_user_data', () => undefined)

    const wrapper = mount(UserDataMissingScreen, {
      global: {
        plugins: [desktop.pinia],
        stubs: {
          BaseDialog: {
            props: ['open', 'labelledby'],
            emits: ['close'],
            template: '<div v-if="open" class="dialog-stub"><slot /></div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('userDataSetup.title')
    expect(wrapper.text()).toContain('userDataSetup.existingTitle')
    expect(wrapper.text()).toContain('userDataSetup.freshTitle')
    expect(wrapper.text()).toContain('userDataSetup.selectFolder')
    expect(wrapper.text()).toContain('userDataSetup.startFresh')

    const buttons = wrapper.findAll('.user-data-missing-actions button')
    expect(buttons).toHaveLength(2)

    await buttons[1].trigger('click')
    await flushPromises()
    expect(desktop.backend.callsOf('relocate_user_data')).toEqual([
      { mode: 'useDefault', path: undefined },
    ])
  })

  it('connects an existing folder from the first-start setup screen', async () => {
    desktop = await loadFakeDesktop({
      userData: {
        path: '/home/u/.local/share/com.tyco.app',
        defaultPath: '/home/u/.local/share/com.tyco.app',
        isDefault: true,
        status: 'notInitialized',
        isWritableByOthers: false,
        deviceId: 'device-1',
        platform: 'linux',
      },
    })
    desktop.backend.handle('pick_directory', () => '/sync/TyCo')
    desktop.backend.handle('inspect_user_data_target', ({ path }) => ({
      path: path ?? '/sync/TyCo',
      isDefault: false,
      isOtherDisk: false,
      contents: { kind: 'userData', formatVersion: 1, isSupported: true },
    }))
    desktop.backend.handle('relocate_user_data', () => undefined)

    const wrapper = mount(UserDataMissingScreen, {
      global: {
        plugins: [desktop.pinia],
        stubs: {
          BaseDialog: {
            props: ['open', 'labelledby'],
            emits: ['close'],
            template: '<div v-if="open" class="dialog-stub"><slot /></div>',
          },
        },
      },
    })

    const buttons = wrapper.findAll('.user-data-missing-actions button')
    await buttons[0].trigger('click')
    await flushPromises()

    const dialog = wrapper.get('.dialog-stub')
    expect(dialog.text()).toContain('settings.userData.connectTitle')
    expect(dialog.text()).not.toContain('settings.userData.current')

    await dialog.get('button.btn-primary').trigger('click')
    await flushPromises()
    expect(desktop.backend.callsOf('relocate_user_data')).toEqual([
      { mode: 'connect', path: '/sync/TyCo' },
    ])
  })
})
