import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AiCommandAddToolModal, {
  type ToolCandidateGroup,
} from './AiCommandAddToolModal.vue'
import type { ToolRef } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mockGroups: ToolCandidateGroup[] = [
  {
    id: 'web',
    label: 'Web search',
    icon: 'mdi:search-web',
    items: [
      {
        ref: { sourceKind: 'core', sourceId: 'web', toolName: 'webSearch' },
        label: 'Web Search',
        risk: 'read',
      },
      {
        ref: { sourceKind: 'core', sourceId: 'web', toolName: 'webFetch' },
        label: 'Web Fetch',
        risk: 'external',
      },
    ],
  },
  {
    id: 'commands',
    label: 'Commands',
    icon: 'mdi:lightning-bolt-outline',
    emptyMessage: 'No commands',
    items: [
      {
        ref: { sourceKind: 'commands', sourceId: 'commands', toolName: 'cmd1' },
        label: 'My Custom Command',
        risk: 'destructive',
      },
    ],
  },
]

describe('AiCommandAddToolModal', () => {
  it('renders groups and tool candidates', () => {
    const wrapper = mount(AiCommandAddToolModal, {
      props: {
        open: true,
        candidateGroups: mockGroups,
        isSelected: () => false,
      },
      global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
    })

    expect(wrapper.text()).toContain('Web search')
    expect(wrapper.text()).toContain('Web Search')
    expect(wrapper.text()).toContain('Web Fetch')
    expect(wrapper.text()).toContain('Commands')
    expect(wrapper.text()).toContain('My Custom Command')
  })

  it('marks already selected tools as added and disables their button', () => {
    const selectedRef: ToolRef = {
      sourceKind: 'core',
      sourceId: 'web',
      toolName: 'webSearch',
    }
    const wrapper = mount(AiCommandAddToolModal, {
      props: {
        open: true,
        candidateGroups: mockGroups,
        isSelected: (ref) =>
          ref.sourceKind === selectedRef.sourceKind &&
          ref.sourceId === selectedRef.sourceId &&
          ref.toolName === selectedRef.toolName,
      },
      global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
    })

    const rows = wrapper.findAll('[role="listitem"]')
    expect(rows[0].text()).toContain('commands.aiToolAlreadyAdded')
    expect(rows[0].find('button').exists()).toBe(false)
    expect(rows[1].find('button').exists()).toBe(true)
  })

  it('filters tools by search query', async () => {
    const wrapper = mount(AiCommandAddToolModal, {
      props: {
        open: true,
        candidateGroups: mockGroups,
        isSelected: () => false,
      },
      global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
    })

    const input = wrapper.get('input')
    await input.setValue('Custom')

    expect(wrapper.text()).not.toContain('Web Search')
    expect(wrapper.text()).toContain('My Custom Command')
  })

  it('emits add event when clicking an unadded tool', async () => {
    const wrapper = mount(AiCommandAddToolModal, {
      props: {
        open: true,
        candidateGroups: mockGroups,
        isSelected: () => false,
      },
      global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
    })

    const rows = wrapper.findAll('[role="listitem"]')
    await rows[1].find('button').trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual([
      { sourceKind: 'core', sourceId: 'web', toolName: 'webFetch' },
    ])
  })

  it('emits close event when clicking close icon button', async () => {
    const wrapper = mount(AiCommandAddToolModal, {
      props: {
        open: true,
        candidateGroups: mockGroups,
        isSelected: () => false,
      },
      global: { stubs: { BaseDialog: { template: '<div><slot /></div>' } } },
    })

    const closeBtn = wrapper.find('button[aria-label="common.cancel"]')
    await closeBtn.trigger('click')

    expect(wrapper.emitted('close')).toBeDefined()
  })
})
