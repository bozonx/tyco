import { shallowMount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'

import ChatMessageItem from './ChatMessageItem.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn() }),
}))

it('offers regeneration only for assistant messages when enabled', async () => {
  const wrapper = shallowMount(ChatMessageItem, {
    props: {
      message: { role: 'assistant', content: 'Answer' },
      canRegenerate: true,
    },
  })
  const actions = () =>
    wrapper.findComponent({ name: 'DropdownMenu' }).props('items') as Array<{
      label: string
      action: () => void
    }>
  actions()
    .find((item) => item.label === 'chat.regenerate')!
    .action()
  expect(wrapper.emitted('regenerate')).toHaveLength(1)
  await wrapper.setProps({ canRegenerate: false })
  expect(actions().some((item) => item.label === 'chat.regenerate')).toBe(false)
  await wrapper.setProps({
    canRegenerate: true,
    message: { role: 'user', content: 'Question' },
  })
  expect(actions().some((item) => item.label === 'chat.regenerate')).toBe(false)
  wrapper.unmount()
})

it('shows an answer with tool calls step by step and passes the decision on', async () => {
  const wrapper = shallowMount(ChatMessageItem, {
    props: {
      message: {
        role: 'assistant',
        content: 'Let me check.\n\nIt is noon.',
        parts: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'get_current_time',
            input: {},
            state: 'awaiting-approval',
            approvalId: 'a1',
          },
          { type: 'text', text: 'It is noon.' },
        ],
      },
      streaming: true,
      pendingApprovalIds: new Set(['a1']),
    },
  })

  const texts = wrapper.findAllComponents({ name: 'ChatMarkdown' })
  expect(texts.map((text) => text.props('content'))).toEqual([
    'Let me check.',
    'It is noon.',
  ])
  expect(texts.map((text) => text.props('streaming'))).toEqual([false, true])
  const call = wrapper.findComponent({ name: 'ChatToolCall' })
  expect(call.props('isAwaitingAnswer')).toBe(true)

  call.vm.$emit('decide', 'allow-session')
  expect(wrapper.emitted('tool-approval')).toEqual([['a1', 'allow-session']])

  await wrapper.setProps({ pendingApprovalIds: new Set() })
  expect(
    wrapper.findComponent({ name: 'ChatToolCall' }).props('isAwaitingAnswer')
  ).toBe(false)
  wrapper.unmount()
})
