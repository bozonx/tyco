import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
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
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop()
  })

  afterEach(() => desktop.dispose())

  it('marks a file call with the places of its paths', () => {
    const locations = (input: object, toolName = 'move_path') =>
      mount(ChatToolCall, { props: { call: { ...call, toolName, input } } })
        .findAll('.tool-call-location')
        .map((badge) => badge.text())

    expect(
      locations({ from: 'attachments/a.md', to: 'workspace/a.md' })
    ).toEqual(['chat.fileLocation.attachments', 'chat.fileLocation.workspace'])
    // a project not loaded yet is named by its id
    expect(locations({ path: 'projects/site/index.md' }, 'write_file')).toEqual(
      ['site']
    )
    expect(locations({ path: 'workspace/a.md' }, 'web_fetch')).toEqual([])
  })

  it('names the call as its tool does', () => {
    const named = (extra: object) =>
      mount(ChatToolCall, { props: { call: { ...call, ...extra } } })
        .get('.tool-call-name')
        .text()

    expect(named({})).toBe('read_file')
    expect(named({ label: 'Read file' })).toBe('Read file')
    expect(named({ labelKey: 'tools.readFile', label: 'Read file' })).toBe(
      'tools.readFile'
    )
  })

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
    expect(wrapper.get('.tool-call-status').text()).toBe('chat.toolState.done')
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
    // what is to be allowed is in view without a click
    expect(wrapper.find('.tool-call-details').exists()).toBe(true)
    expect(wrapper.get('.tool-call-status').text()).toBe(
      'chat.toolState.awaitingApproval'
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

  it('shows what a waiting write would change instead of its arguments', () => {
    const wrapper = mount(ChatToolCall, {
      props: {
        call: {
          ...call,
          toolName: 'edit_file',
          state: 'awaiting-approval',
          approvalId: 'a1',
        },
        isAwaitingAnswer: true,
        preview: {
          kind: 'file-change',
          path: 'workspace/todo.md',
          before: 'Buy milk\n',
          after: 'Buy bread\n',
        },
      },
    })

    const lines = wrapper.findAll('.tool-change-lines .line')
    expect(lines.map((line) => line.text())).toEqual([
      '− Buy milk',
      '+ Buy bread',
    ])
    expect(wrapper.text()).not.toContain('chat.toolArguments')
  })
})
