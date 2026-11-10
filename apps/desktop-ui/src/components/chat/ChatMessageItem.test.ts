import type { ChatMessage } from '@tyco/shared'
import { mount, shallowMount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import { applyAnswerState } from '../../lib/chat-tools/chat-message-steps'
import { runChatToolLoop } from '../../lib/chat-tools/chat-tool-loop'
import { createChatToolPolicy } from '../../lib/chat-tools/chat-tool-policy'
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
      pendingApprovals: new Map([
        [
          'a1',
          {
            approvalId: 'a1',
            toolCallId: 'c1',
            toolName: 'get_current_time',
            input: {},
            approvalKey: 'get_current_time',
          },
        ],
      ]),
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

  await wrapper.setProps({ pendingApprovals: new Map() })
  expect(
    wrapper.findComponent({ name: 'ChatToolCall' }).props('isAwaitingAnswer')
  ).toBe(false)
  wrapper.unmount()
})

it('renders propose_replies as ReplyBlock components and emits block actions', () => {
  const wrapper = shallowMount(ChatMessageItem, {
    props: {
      message: {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'pr1',
            toolName: 'propose_replies',
            input: {
              blocks: [
                { title: 'Option 1', text: 'First answer' },
                { title: 'Option 2', text: 'Second answer' },
              ],
            },
            state: 'done',
          },
        ],
      },
      canRegenerate: true,
    },
  })

  expect(wrapper.find('.reply-blocks-label').text()).toContain(
    'chatTools.replyBlocks.toolLabel'
  )

  const blocks = wrapper.findAllComponents({ name: 'ReplyBlock' })
  expect(blocks).toHaveLength(2)
  expect(blocks[0].props('block')).toEqual({
    title: 'Option 1',
    text: 'First answer',
  })

  blocks[0].vm.$emit('insert', 'First answer')
  expect(wrapper.emitted('insert-reply-block')).toEqual([['First answer']])

  blocks[1].vm.$emit('insertEditor', 'Second answer')
  expect(wrapper.emitted('insert-editor-reply-block')).toEqual([
    ['Second answer'],
  ])

  expect(wrapper.findComponent({ name: 'DropdownMenu' }).exists()).toBe(false)
  const regenerateBtn = wrapper.findComponent({ name: 'IconButton' })
  expect(regenerateBtn.exists()).toBe(true)
  expect(regenerateBtn.props('label')).toBe('chat.regenerate')
  regenerateBtn.vm.$emit('click')
  expect(wrapper.emitted('regenerate')).toHaveLength(1)

  wrapper.unmount()
})

it('hides message actions on reply-blocks-only messages when regeneration is unavailable and keeps full menu for mixed messages', async () => {
  const wrapper = shallowMount(ChatMessageItem, {
    props: {
      message: {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'pr1',
            toolName: 'propose_replies',
            input: { blocks: [{ text: 'Only block' }] },
            state: 'done',
          },
        ],
      },
      canRegenerate: false,
    },
  })

  expect(wrapper.find('.message-actions').exists()).toBe(false)

  await wrapper.setProps({
    canRegenerate: true,
    message: {
      role: 'assistant',
      content: 'Here are two options:',
      parts: [
        { type: 'text', text: 'Here are two options:' },
        {
          type: 'tool-call',
          toolCallId: 'pr1',
          toolName: 'propose_replies',
          input: { blocks: [{ text: 'Block with intro' }] },
          state: 'done',
        },
      ],
    },
  })

  expect(wrapper.findComponent({ name: 'DropdownMenu' }).exists()).toBe(true)
  expect(wrapper.findComponent({ name: 'IconButton' }).props('label')).toBe(
    'chat.copy'
  )

  wrapper.unmount()
})

it('updates tool call status badge in reactive message as tool results arrive', async () => {
  const message = reactive<ChatMessage>({ role: 'assistant', content: '' })
  const wrapper = mount(ChatMessageItem, {
    props: { message, streaming: true },
    global: {
      stubs: {
        ChatMarkdown: true,
        AppIcon: true,
        IconButton: true,
        DropdownMenu: true,
      },
    },
  })

  let emitResult!: () => void
  const waitForResult = new Promise<void>((resolve) => {
    emitResult = resolve
  })

  const loopPromise = runChatToolLoop(
    {
      stream: async function* () {
        yield { type: 'model', provider: 'fake', model: 'fake-model' }
        yield {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'web_search',
          input: { query: 'test' },
        }
        await waitForResult
        yield {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'web_search',
          output: 'Result',
          isError: false,
        }
        yield { type: 'step-finish', step: 0, finishReason: 'tool-calls' }
        yield { type: 'text', text: 'Done.' }
        yield { type: 'step-finish', step: 1, finishReason: 'stop' }
        yield {
          type: 'finish',
          finishReason: 'stop',
          text: 'Done.',
          responseMessages: [],
        }
      },
      requestApproval: async () => 'allow-once',
      policy: createChatToolPolicy({ canAsk: true }),
    },
    {
      prompt: { messages: [{ role: 'user', content: 'hi' }], system: '' },
      tools: null,
      maxStepCount: 4,
      signal: new AbortController().signal,
      onUpdate: (answer) => applyAnswerState(message, answer),
    }
  )

  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('chat.toolState.pending')
  })

  emitResult()
  await loopPromise
  await nextTick()

  expect(wrapper.text()).toContain('chat.toolState.done')
  expect(wrapper.text()).not.toContain('chat.toolState.pending')

  wrapper.unmount()
})
