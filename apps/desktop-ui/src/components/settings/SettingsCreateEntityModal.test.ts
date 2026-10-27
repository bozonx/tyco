import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsCreateEntityModal.vue', () => {
  const mountModal = (
    props: Partial<
      InstanceType<typeof SettingsCreateEntityModal>['$props']
    > = {}
  ) =>
    mount(SettingsCreateEntityModal, {
      props: {
        open: true,
        title: 'New Profile',
        label: 'Profile Name',
        confirmText: 'Create Profile',
        ...props,
      },
      global: {
        stubs: {
          BaseDialog: {
            props: ['open', 'labelledby'],
            emits: ['close'],
            template: '<div v-if="open" class="dialog-stub"><slot /></div>',
          },
        },
      },
    })

  it('renders title, label, and buttons', () => {
    const wrapper = mountModal()
    expect(wrapper.text()).toContain('New Profile')
    expect(wrapper.text()).toContain('Profile Name')
    expect(wrapper.text()).toContain('common.cancel')
    expect(wrapper.text()).toContain('Create Profile')
  })

  it('disables submit button when input is empty or whitespace', async () => {
    const wrapper = mountModal()
    const submitButton = wrapper.find('button[type="submit"]')
    expect(submitButton.attributes('disabled')).toBeDefined()

    const input = wrapper.find('input')
    await input.setValue('   ')
    expect(submitButton.attributes('disabled')).toBeDefined()

    await input.setValue('My Profile')
    expect(submitButton.attributes('disabled')).toBeUndefined()
  })

  it('emits submit with trimmed name on form submit', async () => {
    const wrapper = mountModal()
    const input = wrapper.find('input')
    await input.setValue('  My Profile  ')

    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([['My Profile']])
  })

  it('emits close on cancel button click', async () => {
    const wrapper = mountModal()
    const cancelButton = wrapper.find('button[type="button"]')
    await cancelButton.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('disables input and buttons while submitting', () => {
    const wrapper = mountModal({ isSubmitting: true })
    const input = wrapper.find('input')
    const submitBtn = wrapper.find('button[type="submit"]')
    const cancelBtn = wrapper.find('button[type="button"]')

    expect(input.attributes('disabled')).toBeDefined()
    expect(submitBtn.attributes('disabled')).toBeDefined()
    expect(cancelBtn.attributes('disabled')).toBeDefined()
  })

  it('resets input when reopened', async () => {
    const wrapper = mountModal({ open: false })
    await wrapper.setProps({ open: true })
    const input = wrapper.find('input')
    await input.setValue('Previous text')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
  })
})
