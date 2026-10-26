import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { VaultTarget } from '@tyco/shared'

import SettingsVaultLocationModal from './SettingsVaultLocationModal.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const vault = vi.hoisted(() => ({ store: null as unknown }))
vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => vault.store,
}))

const target = (
  path: string,
  contents: VaultTarget['contents']
): VaultTarget => ({ path, isDefault: false, contents })

function createStore() {
  return reactive({
    profiles: [{ id: 'writer' }],
    projects: [],
    pickFolder: vi.fn(async (): Promise<string | null> => '/new'),
    inspectVaultTarget: vi.fn(async (path?: string): Promise<VaultTarget> =>
      target(path ?? '/default', { kind: 'empty' })
    ),
    relocateVault: vi.fn(async () => {}),
  })
}

describe('SettingsVaultLocationModal.vue', () => {
  let store: ReturnType<typeof createStore>
  beforeEach(() => {
    store = createStore()
    vault.store = store
  })
  afterEach(() => vi.clearAllMocks())

  const mountModal = () =>
    mount(SettingsVaultLocationModal, {
      props: { open: true, currentPath: '/vault', isCustom: true },
      global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
    })
  const button = (wrapper: ReturnType<typeof mountModal>, label: string) =>
    wrapper.findAll('button').find((item) => item.text().includes(label))!

  it('moves the vault into an empty folder by default', async () => {
    const wrapper = mountModal()
    expect(
      button(wrapper, 'settings.vaultApplySwitch').attributes('disabled')
    ).toBeDefined()
    await button(wrapper, 'settings.selectFolder').trigger('click')
    await flushPromises()
    expect(store.inspectVaultTarget).toHaveBeenCalledWith('/new')
    expect(wrapper.text()).toContain('settings.vaultTargetEmptyMove')
    await button(wrapper, 'settings.vaultApplyMove').trigger('click')
    await flushPromises()
    expect(store.relocateVault).toHaveBeenCalledWith('/new', true)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('switches to another vault without moving', async () => {
    store.inspectVaultTarget.mockResolvedValueOnce(
      target('/other', { kind: 'vault', profileCount: 1, projectCount: 0 })
    )
    const wrapper = mountModal()
    await button(wrapper, 'settings.selectFolder').trigger('click')
    await flushPromises()
    await button(wrapper, 'settings.vaultApplySwitch').trigger('click')
    await flushPromises()
    expect(store.relocateVault).toHaveBeenCalledWith('/other', false)
  })

  it('offers a subfolder of a folder with files', async () => {
    store.inspectVaultTarget.mockResolvedValueOnce(
      target('/docs', { kind: 'occupied', subfolderPath: '/docs/tyco-vault' })
    )
    const wrapper = mountModal()
    await button(wrapper, 'settings.selectFolder').trigger('click')
    await flushPromises()
    await button(wrapper, 'settings.vaultUseSubfolder').trigger('click')
    await flushPromises()
    expect(store.inspectVaultTarget).toHaveBeenLastCalledWith(
      '/docs/tyco-vault'
    )
  })

  it('goes back to the default folder and shows failures', async () => {
    store.relocateVault.mockRejectedValueOnce(new Error('Busy'))
    const wrapper = mountModal()
    await button(wrapper, 'settings.vaultUseDefault').trigger('click')
    await flushPromises()
    expect(store.inspectVaultTarget).toHaveBeenCalledWith(undefined)
    await button(wrapper, 'settings.vaultApplyMove').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Busy')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
