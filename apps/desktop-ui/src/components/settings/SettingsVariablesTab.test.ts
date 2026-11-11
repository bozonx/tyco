import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createTestSettingsContext } from '../../test/settings-context'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import {
  DEFAULT_USER_CONFIG,
  normalizeUserConfig,
  type UserConfig,
} from '@tyco/shared'

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
    variables: Array<{ id: string; name: string }> = [],
    commands: Partial<UserConfig>['commands'] = []
  ) => {
    const context = createTestSettingsContext({
      variables,
      variableValues: {},
      ...(commands.length ? { commands } : {}),
    })
    return {
      context,
      wrapper: mount(SettingsVariablesTab, {
        global: {
          provide: context.provide,
          stubs: {
            Teleport: true,
            DragHandle: {
              emits: ['drag'],
              template: '<button class="drag-handle-stub" />',
            },
            FieldPromptTextArea: {
              props: ['modelValue', 'placeholder', 'modalTitle', 'dataTestid'],
              emits: ['update:modelValue'],
              template:
                '<textarea class="prompt-textarea-stub" :data-testid="dataTestid" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            },
            ConfirmModal: {
              props: ['open', 'message'],
              emits: ['confirm', 'cancel'],
              template:
                '<div v-if="open" class="confirm-stub">{{ message }}<button class="confirm-yes" @click="$emit(\'confirm\')" /></div>',
            },
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

  it('creates a new variable directly at the start of the list with animation when create button is clicked', async () => {
    const { wrapper, context } = mountTab([{ id: 'v1', name: 'EXISTING' }])
    expect(context.draft.value.variables).toHaveLength(1)

    await wrapper.find('.add-btn').trigger('click')
    await nextTick()

    expect(context.draft.value.variables).toHaveLength(2)
    // Newly created variable is at index 0 (start of the list)
    const firstVar = context.draft.value.variables[0]!
    expect(firstVar.name).toBe('VAR')

    const cards = wrapper.findAll('.variable-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.classes()).toContain('is-new')
  })

  it('shows empty message when there are no variables', () => {
    const { wrapper } = mountTab([])
    expect(wrapper.find('.variables-empty').exists()).toBe(true)
    expect(wrapper.find('.variables-empty').text()).toBe('variables.empty')
  })

  it('lists existing variables and allows updating value via textarea', async () => {
    const { wrapper, context } = mountTab([{ id: 'v1', name: 'CUSTOM_VAR' }])
    expect(wrapper.find('.variables-empty').exists()).toBe(false)
    const card = wrapper.find('[data-testid="variable-v1"]')
    expect(card.exists()).toBe(true)
    const badge = card.find('.variable-card-actions .variable-usage-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('0')
    expect(badge.classes()).toContain('ui-badge--muted')
    expect(badge.attributes('title')).toBe('variables.unused')
    expect(badge.attributes('aria-label')).toBe('variables.unused')
    expect(card.text()).not.toContain('{{var:CUSTOM_VAR}}')
    expect(wrapper.find('.drag-handle-stub').exists()).toBe(true)

    const textarea = wrapper.find('[data-testid="variable-value-v1"]')
    expect(textarea.exists()).toBe(true)
    await textarea.setValue('my-new-value')

    expect(context.draft.value.variableValues['v1']).toBe('my-new-value')
  })

  it('shows nested reference errors without device badges', async () => {
    const { wrapper, context } = mountTab([
      { id: 'root', name: 'ROOT' },
      { id: 'child', name: 'CHILD' },
    ])
    context.draft.value.variableValues = {
      root: '{{var:CHILD}}',
      child: '{{var:ROOT}}',
    }
    await nextTick()
    expect(wrapper.text()).toContain('variables.hintCycle')
    expect(wrapper.findComponent({ name: 'DeviceScopeBadge' }).exists()).toBe(
      false
    )
    await wrapper
      .find('[data-testid="variable-root"] .variable-card-header button')
      .trigger('click')
    expect(wrapper.find('.confirm-stub').text()).toContain('"count":1')
    expect(context.draft.value.variables).toHaveLength(2)
  })

  it('allows removing a variable', async () => {
    const { wrapper, context } = mountTab([{ id: 'v1', name: 'CUSTOM_VAR' }])
    const removeBtn = wrapper.find(
      '[data-testid="variable-v1"] .variable-card-header button'
    )
    await removeBtn.trigger('click')

    expect(context.draft.value.variables).toHaveLength(0)
  })

  it('asks before removing a variable that commands use', async () => {
    const { wrapper, context } = mountTab(
      [{ id: 'v1', name: 'NOTES' }],
      normalizeUserConfig({
        ...DEFAULT_USER_CONFIG,
        commands: [
          {
            id: 'c1',
            name: 'Ask',
            toolId: 'core.aiTask',
            toolConfig: { prompt: '{{var:NOTES}}' },
          },
        ],
      }).commands
    )
    const badge = wrapper.find(
      '[data-testid="variable-v1"] .variable-card-actions .variable-usage-badge'
    )
    expect(badge.text()).toBe('1')
    expect(badge.classes()).toContain('ui-badge--neutral')
    expect(badge.attributes('title')).toBe('variables.usedBy {"count":1}')
    expect(badge.attributes('aria-label')).toBe('variables.usedBy {"count":1}')

    await wrapper
      .find('[data-testid="variable-v1"] .variable-card-header button')
      .trigger('click')
    expect(context.draft.value.variables).toHaveLength(1)
    expect(wrapper.find('.confirm-stub').text()).toContain('"count":1')

    await wrapper.find('.confirm-yes').trigger('click')
    expect(context.draft.value.variables).toHaveLength(0)
  })
})
