import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { UserDataFolderModel } from '../../lib/storage/user-data-folder-model'
import type { UserDataRelocation } from '../../lib/storage/user-data-relocation'
import UserDataRelocationModal from './UserDataRelocationModal.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

function createStubModel(
  overrides?: Partial<UserDataFolderModel>
): UserDataFolderModel {
  const isBusyRef = ref(false)
  const isApplyingRef = ref(false)
  const relocationRef = ref<UserDataRelocation | null>(null)

  return {
    action: ref('choose'),
    moveCurrent: ref(true),
    target: ref(null),
    relocation: computed(() => relocationRef.value),
    isBusy: computed(() => isBusyRef.value),
    isApplying: isApplyingRef,
    errorMessage: ref(''),
    isConfirmingCrossDisk: ref(false),
    start: vi.fn(),
    setMoveCurrent: vi.fn(),
    pickFolder: vi.fn(),
    useSubfolder: vi.fn(),
    dismissCrossDiskConfirm: vi.fn(),
    apply: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  }
}

describe('UserDataRelocationModal.vue', () => {
  it('renders current path with PathDisplay and checkbox when choosing location', () => {
    const model = createStubModel()
    const wrapper = mount(UserDataRelocationModal, {
      props: { model, currentPath: '/home/user/.tyco' },
      global: {
        stubs: {
          BaseDialog: { template: '<div class="dialog-stub"><slot /></div>' },
        },
      },
    })

    expect(wrapper.findComponent({ name: 'PathDisplay' }).props('path')).toBe(
      '/home/user/.tyco'
    )
    expect(wrapper.findComponent({ name: 'FieldCheckbox' }).exists()).toBe(true)
    expect(wrapper.text()).toContain('settings.userData.selectLocation')
  })

  it('renders target folder and notice when target is selected', () => {
    const model = createStubModel({
      target: ref({
        path: '/mnt/storage/tyco',
        isDefault: false,
        isOtherDisk: false,
        contents: { kind: 'empty' },
      }),
      relocation: computed(() => ({
        mode: 'move',
        notice: {
          kind: 'info',
          messageKey: 'settings.userData.targetEmptyMove',
        },
      })),
    })

    const wrapper = mount(UserDataRelocationModal, {
      props: { model, currentPath: '/home/user/.tyco' },
      global: {
        stubs: {
          BaseDialog: { template: '<div class="dialog-stub"><slot /></div>' },
        },
      },
    })

    const pathDisplays = wrapper.findAllComponents({ name: 'PathDisplay' })
    expect(pathDisplays).toHaveLength(2)
    expect(pathDisplays[1].props('path')).toBe('/mnt/storage/tyco')
    expect(wrapper.text()).toContain('settings.userData.applyMove')
    expect(wrapper.text()).toContain('settings.userData.restartNotice')
  })

  it('handles cross-disk confirmation state', async () => {
    const model = createStubModel({
      isConfirmingCrossDisk: ref(true),
      target: ref({
        path: '/mnt/other/tyco',
        isDefault: false,
        isOtherDisk: true,
        contents: { kind: 'empty' },
      }),
      relocation: computed(() => ({
        mode: 'move',
        notice: {
          kind: 'info',
          messageKey: 'settings.userData.targetEmptyMove',
        },
      })),
    })

    const wrapper = mount(UserDataRelocationModal, {
      props: { model, currentPath: '/home/user/.tyco' },
      global: {
        stubs: {
          BaseDialog: { template: '<div class="dialog-stub"><slot /></div>' },
        },
      },
    })

    expect(wrapper.text()).toContain('settings.userData.crossDiskConfirm')
    const buttons = wrapper.findAll('.user-data-modal-actions button')
    expect(buttons).toHaveLength(2)
    await buttons[0].trigger('click')
    expect(model.dismissCrossDiskConfirm).toHaveBeenCalled()
    await buttons[1].trigger('click')
    expect(model.apply).toHaveBeenCalled()
  })
})
