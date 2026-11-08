import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsCreateCommandModal from './SettingsCreateCommandModal.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsCreateCommandModal.vue', () => {
  const tools = [
    {
      id: 'script',
      name: 'Script / Command',
      description: 'Runs a shell command',
    },
    { id: 'webhook', name: 'Webhook', description: 'Sends HTTP request' },
    {
      id: 'core.aiTask',
      name: 'AI Command',
      description: 'AI performs prompt',
    },
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

  it('renders title, close button, and tool options', () => {
    const wrapper = mountModal()
    expect(wrapper.text()).toContain('commands.createModalTitle')
    expect(wrapper.text()).toContain('commands.toolTypeLabel')

    const closeBtn = wrapper.find('button[aria-label="common.cancel"]')
    expect(closeBtn.exists()).toBe(true)

    const items = wrapper.findAll('.create-command-item')
    // script, webhook, ai (none), ai (fix), ai (translate), ai (style)
    expect(items).toHaveLength(6)
  })

  it('selects script tool on single click', async () => {
    const wrapper = mountModal()
    const items = wrapper.findAll('.create-command-item')
    await items[0].trigger('click')

    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { toolId: 'script', template: undefined },
    ])
  })

  it('selects webhook tool on single click', async () => {
    const wrapper = mountModal()
    const items = wrapper.findAll('.create-command-item')
    await items[1].trigger('click')

    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { toolId: 'webhook', template: undefined },
    ])
  })

  it('selects AI tool template in single click', async () => {
    const wrapper = mountModal()
    const items = wrapper.findAll('.create-command-item')
    // item 2: core.aiTask (none)
    // item 3: core.aiTask (fix)
    // item 4: core.aiTask (translate)
    // item 5: core.aiTask (style)
    await items[3].trigger('click')

    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { toolId: 'core.aiTask', template: 'fix' },
    ])
  })

  it('emits close when header close button is clicked', async () => {
    const wrapper = mountModal()
    const closeBtn = wrapper.find('button[aria-label="common.cancel"]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeDefined()
  })
})
