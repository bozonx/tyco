import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ChatToolCall from './ChatToolCall.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

const call = {
  type: 'tool-call' as const,
  toolCallId: 'c1',
  toolName: 'read_file',
  input: { path: 'notes/todo.md' },
  state: 'done' as const,
}

describe('ChatToolCall', () => {
  it('shows the call collapsed and its arguments and result expanded', async () => {
    const wrapper = mount(ChatToolCall, {
      props: {
        call,
        result: {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'read_file',
          output: 'Buy milk',
          isTruncated: true,
        },
      },
    })

    expect(wrapper.text()).toContain('read_file')
    expect(wrapper.text()).toContain('{"path":"notes/todo.md"}')
    expect(wrapper.text()).toContain('chat.toolState.done')
    expect(wrapper.text()).not.toContain('Buy milk')

    await wrapper.get('button').trigger('click')

    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('Buy milk')
    expect(wrapper.text()).toContain('chat.toolResultTruncated')
  })

  it('asks inline while the call waits and reports the answer', async () => {
    const wrapper = mount(ChatToolCall, {
      props: {
        call: { ...call, state: 'awaiting-approval', approvalId: 'a1' },
        isAwaitingAnswer: true,
      },
    })

    expect(wrapper.text()).toContain(
      'chat.toolApprovalQuestion:{"tool":"read_file"}'
    )
    const buttons = wrapper.findAll('.tool-approval button')
    expect(buttons.map((button) => button.text())).toEqual([
      'chat.toolAllow',
      'chat.toolAllowSession',
      'chat.toolDeny',
    ])
    await buttons[2].trigger('click')
    expect(wrapper.emitted('decide')).toEqual([['deny']])

    await wrapper.setProps({ isAwaitingAnswer: false })
    expect(wrapper.find('.tool-approval').exists()).toBe(false)
  })
})
