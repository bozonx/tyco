import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import SettingsVariablesTab from './SettingsVariablesTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

describe('SettingsVariablesTab.vue', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop()
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountTab = (
    variables: Array<{ id: string; name: string; description: string }> = []
  ) => {
    const context = createTestSettingsContext({ variables, variableValues: {} })
    return {
      context,
      wrapper: mount(SettingsVariablesTab, {
        global: {
          provide: context.provide,
          stubs: {
            Teleport: true,
            SettingsCreateVariableModal: {
              props: ['open'],
              emits: ['close'],
              template: '<div class="create-modal-stub" :data-open="open" />',
            },
            DirectoryPickerButton: true,
          },
        },
      }),
    }
  }

  it('renders section title, info popover, and create button', () => {
    const { wrapper } = mountTab()
    const section = wrapper.findComponent({ name: 'SettingsSection' })
    expect(section.props('title')).toBe('variables.listTitle')

    const createBtn = wrapper.find('.add-btn')
    expect(createBtn.exists()).toBe(true)
    expect(createBtn.text()).toContain('variables.create')

    const popover = wrapper.findComponent({ name: 'InfoPopover' })
    expect(popover.exists()).toBe(true)
  })

  it('contains variable guidance, secrets warning, and built-ins in the info popover', async () => {
    const { wrapper } = mountTab()
    const popover = wrapper.findComponent({ name: 'InfoPopover' })
    await popover.find('button').trigger('click')
    expect(popover.text()).toContain('variables.hint')
    expect(popover.text()).toContain('variables.notForSecrets')
    expect(popover.text()).toContain('variables.builtinTitle')
    expect(popover.text()).toContain('{{var:TYCO_USER_DIR}}')
    expect(popover.text()).toContain('{{var:TYCO_DEVICE_ID}}')
  })

  it('opens create modal when create button is clicked', async () => {
    const { wrapper } = mountTab()
    const modalStub = wrapper.find('.create-modal-stub')
    expect(modalStub.attributes('data-open')).toBe('false')

    await wrapper.find('.add-btn').trigger('click')
    expect(modalStub.attributes('data-open')).toBe('true')
  })

  it('shows empty message when there are no variables', () => {
    const { wrapper } = mountTab([])
    expect(wrapper.find('.variables-empty').exists()).toBe(true)
    expect(wrapper.find('.variables-empty').text()).toBe('variables.empty')
  })

  it('lists existing variables and allows removing one', async () => {
    const { wrapper, context } = mountTab([
      { id: 'v1', name: 'CUSTOM_VAR', description: 'My variable' },
    ])
    expect(wrapper.find('.variables-empty').exists()).toBe(false)
    expect(wrapper.find('[data-testid="variable-v1"]').exists()).toBe(true)

    const removeBtn = wrapper.find('[data-testid="variable-v1"] button')
    await removeBtn.trigger('click')

    expect(context.draft.value.variables).toHaveLength(0)
  })
})
