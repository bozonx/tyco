import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsProjectConvertDialog from './SettingsProjectConvertDialog.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mountDialog = (props: {
  toExternal: boolean
  hasSourceFolder?: boolean
}) =>
  mount(SettingsProjectConvertDialog, {
    props: {
      open: false,
      hasSourceFolder: false,
      selectFolder: vi.fn(async () => '/work'),
      ...props,
    },
    global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
  })

describe('SettingsProjectConvertDialog.vue', () => {
  it('needs a folder to make a project external and moves the files', async () => {
    const wrapper = mountDialog({ toExternal: true })
    await wrapper.setProps({ open: true })
    const confirm = wrapper.get('[data-testid="convert-confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="project-folder-pick"]').trigger('click')
    await vi.waitFor(() =>
      expect(confirm.attributes('disabled')).toBeUndefined()
    )
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toEqual([
      [{ targetPath: '/work', transferFiles: true }],
    ])
  })

  it('warns that files stay behind when they are not transferred', async () => {
    const wrapper = mountDialog({ toExternal: false, hasSourceFolder: true })
    await wrapper.setProps({ open: true })
    expect(wrapper.text()).not.toContain('settings.projectConvertFilesStay')
    await wrapper
      .findComponent({ name: 'FieldCheckbox' })
      .vm.$emit('update:modelValue', false)
    expect(wrapper.text()).toContain('settings.projectConvertFilesStay')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toEqual([
      [{ targetPath: undefined, transferFiles: false }],
    ])
  })

  it('cannot copy files of a project without its folder on this device', async () => {
    const wrapper = mountDialog({ toExternal: false })
    await wrapper.setProps({ open: true })
    expect(
      wrapper
        .get('input[data-testid="convert-transfer"]')
        .attributes('disabled')
    ).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toEqual([
      [{ targetPath: undefined, transferFiles: false }],
    ])
  })
})
