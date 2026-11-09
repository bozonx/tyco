import { shallowMount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'

import type { QuickAiRequestTurn } from '../../lib/quick-ai-request/quick-ai-request-model'
import QuickAiRequestTurns from './QuickAiRequestTurns.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn() }),
}))

const turnWith = (
  answer: QuickAiRequestTurn['answer'],
  status: QuickAiRequestTurn['status'] = 'done'
): QuickAiRequestTurn => ({
  id: 'chat-0',
  prompt: 'Question',
  inputKind: 'text',
  answer,
  status,
})

it('shows a plain answer as markdown', () => {
  const wrapper = shallowMount(QuickAiRequestTurns, {
    props: {
      turns: [turnWith({ role: 'assistant', content: '**Bold** answer' })],
    },
  })
  const texts = wrapper.findAllComponents({ name: 'ChatMarkdown' })
  expect(texts.map((text) => text.props('content'))).toEqual([
    '**Bold** answer',
  ])
})

it('shows the steps in order and lets the user answer a waiting call', async () => {
  const wrapper = shallowMount(QuickAiRequestTurns, {
    props: {
      turns: [
        turnWith(
          {
            role: 'assistant',
            content: 'Let me check.',
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
              { type: 'text', text: 'Waiting.' },
            ],
          },
          'generating'
        ),
      ],
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
  expect(texts.map((text) => text.props('streaming'))).toEqual([false, true])
  const call = wrapper.findComponent({ name: 'ChatToolCall' })
  expect(call.props('isAwaitingAnswer')).toBe(true)
  call.vm.$emit('decide', 'allow-once')
  expect(wrapper.emitted('answerToolApproval')).toEqual([['a1', 'allow-once']])
})

it('applies a reply block to the window or the editor with the selection to compare', () => {
  const wrapper = shallowMount(QuickAiRequestTurns, {
    props: {
      sourceText: 'Original',
      turns: [
        turnWith({
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool-call',
              toolCallId: 'pr1',
              toolName: 'propose_replies',
              input: { blocks: [{ title: 'Option', text: 'Better' }] },
              state: 'done',
            },
          ],
        }),
      ],
    },
  })

  const block = wrapper.findComponent({ name: 'ReplyBlock' })
  expect(block.props('originalText')).toBe('Original')
  block.vm.$emit('insert', 'Better')
  block.vm.$emit('insertEditor', 'Better')
  const applied = { title: 'Option', text: 'Better' }
  expect(wrapper.emitted('applyReplyBlock')).toEqual([
    [applied, 'window'],
    [applied, 'editor'],
  ])
})
