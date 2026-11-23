import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import { installFakeDesktop } from '../../test/install-fake-desktop'
import ConfirmModal from '../common/ConfirmModal.vue'
import AiCommandOperationFields from './AiCommandOperationFields.vue'
import type { ToolRef } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.name) return `${key}:${params.name}`
      return key
    },
  }),
}))

vi.mock('../../composables/use-plugin-tool-sources', () => ({
  usePluginToolSources: () => ({ value: [] }),
}))

describe('AiCommandOperationFields', () => {
  it('shows empty state when no tools are added', () => {
    const desktop = installFakeDesktop()
    const command = createCommand('core.aiTask', 'agent')
    const wrapper = mount(AiCommandOperationFields, {
      props: {
        command: {
          ...command,
          operationConfig: { ...command.operationConfig, tools: [] },
        },
        warnings: [],
      },
      global: { stubs: { AiCommandAddToolModal: true, ConfirmModal: true } },
    })

    expect(wrapper.text()).toContain('commands.aiNoTools')
    expect(wrapper.find('.ai-tools-actions button').text()).toContain(
      'commands.aiAddTool'
    )
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)

    wrapper.unmount()
    desktop.dispose()
  })

  it('opens add tool modal when clicking add button and handles adding a tool', async () => {
    const desktop = installFakeDesktop()
    const command = createCommand('core.aiTask', 'agent')
    const wrapper = mount(AiCommandOperationFields, {
      props: {
        command: {
          ...command,
          operationConfig: { ...command.operationConfig, tools: [] },
        },
        warnings: [],
      },
      global: {
        stubs: {
          AiCommandAddToolModal: {
            props: ['open', 'candidateGroups', 'isSelected'],
            template:
              '<div v-if="open" class="modal-stub"><button class="add-btn" @click="$emit(\'add\', { sourceKind: \'core\', sourceId: \'web\', toolName: \'web_search\' })">Add</button></div>',
          },
          ConfirmModal: true,
        },
      },
    })

    const addBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('commands.aiAddTool'))!
    await addBtn.trigger('click')

    expect(wrapper.find('.modal-stub').exists()).toBe(true)

    await wrapper.find('.add-btn').trigger('click')

    expect(wrapper.emitted('update')?.at(-1)).toEqual([
      'tools',
      [{ sourceKind: 'core', sourceId: 'web', toolName: 'web_search' }],
    ])

    wrapper.unmount()
    desktop.dispose()
  })

  it('displays added tools and requests confirmation on removal', async () => {
    const desktop = installFakeDesktop()
    const command = createCommand('core.aiTask', 'agent')
    const webRef: ToolRef = {
      sourceKind: 'core',
      sourceId: 'web',
      toolName: 'web_search',
    }
    const wrapper = mount(AiCommandOperationFields, {
      props: {
        command: {
          ...command,
          operationConfig: { ...command.operationConfig, tools: [webRef] },
        },
        warnings: [],
      },
      global: {
        stubs: {
          AiCommandAddToolModal: true,
          BaseDialog: { template: '<div><slot /></div>' },
        },
      },
    })

    expect(wrapper.find('.ai-tool-row').exists()).toBe(true)
    expect(wrapper.text()).toContain('chatTools.web.searchLabel')

    const confirmModalBefore = wrapper.findComponent(ConfirmModal)
    expect(confirmModalBefore.props('open')).toBe(false)

    const deleteBtn = wrapper.find('.ai-tool-row button')
    await deleteBtn.trigger('click')

    const confirmModal = wrapper.findComponent(ConfirmModal)
    expect(confirmModal.props('open')).toBe(true)
    expect(confirmModal.props('title')).toBe(
      'commands.aiRemoveToolConfirmTitle'
    )
    expect(confirmModal.props('message')).toContain('chatTools.web.searchLabel')

    // Cancel removal
    confirmModal.vm.$emit('cancel')
    await wrapper.vm.$nextTick()
    expect(confirmModal.props('open')).toBe(false)
    expect(wrapper.emitted('update')).toBeUndefined()

    // Open again and confirm removal
    await deleteBtn.trigger('click')
    expect(confirmModal.props('open')).toBe(true)

    confirmModal.vm.$emit('confirm')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update')?.at(-1)).toEqual(['tools', []])

    wrapper.unmount()
    desktop.dispose()
  })

  it('displays unavailable tools and removes them when confirmed', async () => {
    const desktop = installFakeDesktop()
    const command = createCommand('core.aiTask', 'agent')
    const unavailableRef: ToolRef = {
      sourceKind: 'plugin',
      sourceId: 'missing-plugin',
      toolName: 'doSomething',
    }
    const wrapper = mount(AiCommandOperationFields, {
      props: {
        command: {
          ...command,
          operationConfig: {
            ...command.operationConfig,
            tools: [unavailableRef],
          },
        },
        warnings: [],
      },
      global: {
        stubs: {
          AiCommandAddToolModal: true,
          BaseDialog: { template: '<div><slot /></div>' },
        },
      },
    })

    expect(wrapper.text()).toContain('commands.aiToolsUnavailable')
    expect(wrapper.text()).toContain('doSomething')
    expect(wrapper.text()).toContain('commands.aiToolUnavailable')

    const deleteBtn = wrapper.find('.ai-tool-row button')
    await deleteBtn.trigger('click')

    const confirmModal = wrapper.findComponent(ConfirmModal)
    expect(confirmModal.props('open')).toBe(true)
    expect(confirmModal.props('message')).toContain('doSomething')

    confirmModal.vm.$emit('confirm')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update')?.at(-1)).toEqual(['tools', []])

    wrapper.unmount()
    desktop.dispose()
  })
})
