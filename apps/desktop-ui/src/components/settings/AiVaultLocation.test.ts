import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import AiVaultLocation from './AiVaultLocation.vue'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastError }),
}))

const vault = vi.hoisted(() => ({ store: null as unknown }))
vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => vault.store,
}))

function createStore() {
  return reactive({
    vaultPath: '/vault',
    vaultError: '',
    isLoaded: true,
    loadAll: vi.fn(async () => {}),
    openVaultDir: vi.fn(async () => {}),
  })
}

describe('AiVaultLocation.vue', () => {
  let desktop: TestDesktop
  let store: ReturnType<typeof createStore>
  let context: ReturnType<typeof createTestSettingsContext>

  beforeEach(async () => {
    desktop = await loadFakeDesktop()
    store = createStore()
    vault.store = store
    context = createTestSettingsContext()
  })

  afterEach(() => {
    desktop.dispose()
    toastError.mockReset()
  })

  const mountLocation = () =>
    mount(AiVaultLocation, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsVaultLocationModal: {
            name: 'SettingsVaultLocationModal',
            props: ['open', 'currentPath', 'isCustom'],
            template: '<div />',
          },
        },
      },
    })
  const button = (wrapper: ReturnType<typeof mountLocation>, label: string) =>
    wrapper.findAll('button').find((item) => item.text().includes(label))!

  it('changes the vault folder in a dialog, never in the draft', async () => {
    const wrapper = mountLocation()
    const modal = wrapper.findComponent({ name: 'SettingsVaultLocationModal' })
    expect(modal.props('open')).toBe(false)
    await button(wrapper, 'settings.vaultChange').trigger('click')
    expect(modal.props('open')).toBe(true)
    expect(modal.props('currentPath')).toBe('/vault')
    await modal.vm.$emit('close')
    expect(modal.props('open')).toBe(false)
    expect(context.draft.value.aiVault.path).toBe('')
    expect(wrapper.text()).toContain('settings.aiVaultGitWarning')
  })

  it('reports a vault folder that cannot be opened', async () => {
    store.openVaultDir.mockRejectedValueOnce(new Error('Missing'))
    const wrapper = mountLocation()
    await button(wrapper, 'settings.openInFileManager').trigger('click')
    await flushPromises()
    expect(toastError.mock.calls).toEqual([[new Error('Missing')]])
  })
})
