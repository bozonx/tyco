import { flushPromises, mount } from '@vue/test-utils'
import type { ProjectTransferPreview } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import SettingsProjectConvertDialog from './SettingsProjectConvertDialog.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const preview = (
  changes: Partial<ProjectTransferPreview> = {},
  files: Partial<ProjectTransferPreview['files']> = {}
): ProjectTransferPreview => ({
  files: {
    fileCount: 2,
    totalBytes: 2048,
    hasGit: false,
    outsideLinks: [],
    ...files,
  },
  takenNames: [],
  isOtherDisk: false,
  sharedFolderCount: 0,
  ...changes,
})

const mountDialog = (props: {
  toExternal: boolean
  hasSourceFolder?: boolean
  inspect?: (targetPath?: string) => Promise<ProjectTransferPreview>
}) =>
  mount(SettingsProjectConvertDialog, {
    props: {
      open: false,
      hasSourceFolder: false,
      selectFolder: vi.fn(async () => '/work'),
      inspect: vi.fn(async () => preview()),
      ...props,
    },
    global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
  })

const openDialog = async (wrapper: ReturnType<typeof mountDialog>) => {
  await wrapper.setProps({ open: true })
  await flushPromises()
}

const checkbox = (wrapper: ReturnType<typeof mountDialog>, label: string) =>
  wrapper
    .findAllComponents({ name: 'FieldCheckbox' })
    .find((item) => item.props('label') === label)!

describe('SettingsProjectConvertDialog.vue', () => {
  it('always moves the files of an internal project to the chosen folder', async () => {
    const inspect = vi.fn(async () => preview())
    const wrapper = mountDialog({ toExternal: true, inspect })
    await openDialog(wrapper)
    expect(inspect).toHaveBeenCalledWith(undefined)
    expect(wrapper.findComponent({ name: 'FieldCheckbox' }).exists()).toBe(
      false
    )
    expect(wrapper.get('[data-testid="convert-summary"]').text()).toBe(
      'settings.projectConvertFileSummary'
    )
    const confirm = wrapper.get('[data-testid="convert-confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="project-folder-pick"]').trigger('click')
    await flushPromises()
    expect(inspect).toHaveBeenLastCalledWith('/work')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toEqual([
      [{ targetPath: '/work', transferFiles: false, trashSource: false }],
    ])
  })

  it('refuses a folder with taken names or links leading out', async () => {
    const wrapper = mountDialog({
      toExternal: true,
      inspect: vi.fn(async () =>
        preview({ takenNames: ['readme.md'] }, { outsideLinks: ['out'] })
      ),
    })
    await openDialog(wrapper)
    await wrapper.get('[data-testid="project-folder-pick"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('settings.projectConvertTakenNames')
    expect(wrapper.text()).toContain('settings.projectConvertOutsideLinks')
    expect(
      wrapper.get('[data-testid="convert-confirm"]').attributes('disabled')
    ).toBeDefined()
  })

  it('copies the files of an external project and may trash its folder', async () => {
    const wrapper = mountDialog({
      toExternal: false,
      hasSourceFolder: true,
      inspect: vi.fn(async () => preview({}, { hasGit: true })),
    })
    await openDialog(wrapper)
    expect(wrapper.text()).toContain('settings.projectConvertSourceStays')
    expect(wrapper.text()).toContain('settings.projectConvertHasGit')
    await checkbox(wrapper, 'settings.projectConvertTrashSource').vm.$emit(
      'update:modelValue',
      true
    )
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toEqual([
      [{ targetPath: undefined, transferFiles: true, trashSource: true }],
    ])
  })

  it('keeps a folder another project uses', async () => {
    const wrapper = mountDialog({
      toExternal: false,
      hasSourceFolder: true,
      inspect: vi.fn(async () => preview({ sharedFolderCount: 1 })),
    })
    await openDialog(wrapper)
    expect(wrapper.text()).toContain('settings.projectConvertTrashShared')
    expect(
      checkbox(wrapper, 'settings.projectConvertTrashSource').props('disabled')
    ).toBe(true)
  })

  it('warns that files stay behind when they are not transferred', async () => {
    const wrapper = mountDialog({ toExternal: false, hasSourceFolder: true })
    await openDialog(wrapper)
    expect(wrapper.text()).not.toContain('settings.projectConvertNoTransfer')
    await checkbox(wrapper, 'settings.projectConvertTransferFiles').vm.$emit(
      'update:modelValue',
      false
    )
    expect(wrapper.text()).toContain('settings.projectConvertNoTransfer')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toEqual([
      [{ targetPath: undefined, transferFiles: false, trashSource: false }],
    ])
  })

  it('has nothing to copy for a project without its folder on this device', async () => {
    const inspect = vi.fn(async () => preview())
    const wrapper = mountDialog({ toExternal: false, inspect })
    await openDialog(wrapper)
    expect(inspect).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('settings.projectConvertNoSourceFolder')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('confirm')).toEqual([
      [{ targetPath: undefined, transferFiles: false, trashSource: false }],
    ])
  })
})
