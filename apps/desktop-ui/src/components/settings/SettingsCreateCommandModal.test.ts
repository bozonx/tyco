import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsCreateCommandModal from './SettingsCreateCommandModal.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsCreateCommandModal.vue', () => {
  const tools = [
    { id: 'script', name: 'Script / Command' },
    { id: 'webhook', name: 'Webhook' },
    { id: 'core.aiTask', name: 'AI Command' },
  ]

  const mountModal = (
    props: Partial<
      InstanceType<typeof SettingsCreateCommandModal>['$props']
    > = {}
  ) =>
    mount(SettingsCreateCommandModal, {
      props: { open: true, tools, ...props },
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

  it('renders title, tool selector and buttons', () => {
    const wrapper = mountModal()
    expect(wrapper.text()).toContain('commands.createModalTitle')
    expect(wrapper.text()).toContain('commands.toolTypeLabel')
    expect(wrapper.text()).toContain('common.cancel')
    expect(wrapper.text()).toContain('common.confirm')
  })

  it('submits selected non-AI tool without template', async () => {
    const wrapper = mountModal()
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { toolId: 'script', template: undefined },
    ])
  })

  it('shows template options when AI task is selected and submits with template', async () => {
    const wrapper = mountModal()
    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(1)

    // select core.aiTask (index 2 in tools)
    await selects[0].setValue('2')

    // template select should now appear
    const updatedSelects = wrapper.findAll('select')
    expect(updatedSelects).toHaveLength(2)

    // select "fix" template (index 1: 0=none, 1=fix, 2=translate, 3=style)
    await updatedSelects[1].setValue('1')

    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { toolId: 'core.aiTask', template: 'fix' },
    ])
  })

  it('emits close when cancel is clicked', async () => {
    const wrapper = mountModal()
    const cancelBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('common.cancel'))
    await cancelBtn?.trigger('click')
    expect(wrapper.emitted('close')).toBeDefined()
  })
})
