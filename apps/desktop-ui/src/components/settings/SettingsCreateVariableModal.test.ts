import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsCreateVariableModal from './SettingsCreateVariableModal.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsCreateVariableModal.vue', () => {
  const mountModal = (open = true) => {
    const context = createTestSettingsContext({
      variables: [{ id: 'var-1', name: 'EXISTING_VAR', description: '' }],
    })
    return {
      context,
      wrapper: mount(SettingsCreateVariableModal, {
        props: { open },
        global: {
          provide: context.provide,
          stubs: {
            BaseDialog: {
              props: ['open', 'labelledby'],
              emits: ['close'],
              template: '<div v-if="open" class="dialog-stub"><slot /></div>',
            },
            IconButton: {
              props: ['icon', 'label'],
              emits: ['click'],
              template:
                '<button type="button" @click="$emit(\'click\')">{{ label }}</button>',
            },
          },
        },
      }),
    }
  }

  it('renders modal title and fields', () => {
    const { wrapper } = mountModal()
    expect(wrapper.text()).toContain('variables.addTitle')
    expect(wrapper.text()).toContain('variables.name')
    expect(wrapper.text()).toContain('variables.description')
    expect(wrapper.text()).toContain('common.cancel')
    expect(wrapper.text()).toContain('variables.add')
  })

  it('shows error when name is empty on submit', async () => {
    const { wrapper } = mountModal()
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('variables.errorNoName')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('shows error when name is already taken', async () => {
    const { wrapper } = mountModal()
    const nameInput = wrapper.find('[data-testid="variable-new-name"]')
    await nameInput.setValue('EXISTING_VAR')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('variables.errorNameTaken')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('adds variable and emits close on valid submit', async () => {
    const { wrapper, context } = mountModal()
    const nameInput = wrapper.find('[data-testid="variable-new-name"]')
    await nameInput.setValue('NEW_VAR')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(context.draft.value.variables.map((v) => v.name)).toContain(
      'NEW_VAR'
    )
  })

  it('emits close on cancel click', async () => {
    const { wrapper } = mountModal()
    const buttons = wrapper.findAll('button')
    const cancelBtn = buttons.find((b) => b.text().includes('common.cancel'))
    await cancelBtn?.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
