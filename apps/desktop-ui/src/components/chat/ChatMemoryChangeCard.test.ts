import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeDesktopError } from '../../test/fake-desktop-backend'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ChatMemoryChangeCard from './ChatMemoryChangeCard.vue'

const mocks = vi.hoisted(() => ({
  goToConfig: vi.fn(),
  toastKey: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: mocks.toastKey, toastError: mocks.toastError }),
}))

vi.mock('../../navigation', () => ({
  appNavigation: { goToConfig: mocks.goToConfig },
}))

vi.mock('../../composables/use-chat-scope', () => ({
  useChatScope: () => ({
    chat: {
      profileId: 'test-profile',
      currentChatParams: { id: 'chat-1' },
      refreshProfile: async () => undefined,
    },
  }),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.file) return `${key}:${params.file}`
      return key
    },
  }),
}))

const undoCall = {
  type: 'tool-call',
  toolCallId: 'c3',
  toolName: 'memory_add',
  input: { file: 'health.md', fact: 'Fact to undo' },
  state: 'done',
} as const

const clickableButton = {
  props: ['disabled'],
  template:
    '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

describe('ChatMemoryChangeCard', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop()
  })

  afterEach(() => desktop.dispose())

  it('renders memory update card for memory_add', () => {
    const wrapper = mount(ChatMemoryChangeCard, {
      props: {
        call: {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'memory_add',
          input: { file: 'health.md', fact: 'Caffeine intolerance' },
          state: 'done',
        },
      },
      global: {
        plugins: [desktop.pinia],
        stubs: { AppIcon: true, Button: true },
      },
    })

    expect(wrapper.text()).toContain('chatTools.memory.memoryUpdated:health.md')
    expect(wrapper.text()).toContain('Caffeine intolerance')
    expect(wrapper.find('.memory-diff-line.is-added').exists()).toBe(true)
  })

  it('renders removed and added lines for memory_replace', () => {
    const wrapper = mount(ChatMemoryChangeCard, {
      props: {
        call: {
          type: 'tool-call',
          toolCallId: 'c2',
          toolName: 'memory_replace',
          input: { file: 'core.md', old: 'Old fact', new: 'New fact' },
          state: 'done',
        },
      },
      global: {
        plugins: [desktop.pinia],
        stubs: { AppIcon: true, Button: true },
      },
    })

    expect(wrapper.find('.memory-diff-line.is-removed').text()).toContain(
      'Old fact'
    )
    expect(wrapper.find('.memory-diff-line.is-added').text()).toContain(
      'New fact'
    )
  })

  it('calls undo IPC on undo click', async () => {
    desktop.backend.handle('undo_ai_profile_memory', ({ file }) => ({
      file,
      after: '',
    }))
    const wrapper = mount(ChatMemoryChangeCard, {
      props: { call: undoCall },
      global: {
        plugins: [desktop.pinia],
        stubs: { AppIcon: true, Button: clickableButton },
      },
    })

    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()

    expect(desktop.backend.callsOf('undo_ai_profile_memory')).toEqual([
      { profileId: 'test-profile', chatId: 'chat-1', file: 'health.md' },
    ])
    expect(mocks.toastKey).toHaveBeenCalledWith(
      'chatTools.memory.undoSuccess',
      'info'
    )
  })

  it('reports a failed undo instead of confirming it', async () => {
    desktop.backend.handle('undo_ai_profile_memory', () => {
      throw new FakeDesktopError({
        code: 'operationFailed',
        message: 'Nothing to undo',
      })
    })
    const wrapper = mount(ChatMemoryChangeCard, {
      props: { call: undoCall },
      global: {
        plugins: [desktop.pinia],
        stubs: { AppIcon: true, Button: clickableButton },
      },
    })

    await wrapper.findAll('button')[0].trigger('click')
    await flushPromises()

    expect(mocks.toastError).toHaveBeenCalledOnce()
    expect(mocks.toastKey).not.toHaveBeenCalled()
    expect(wrapper.findAll('button')[0].attributes('disabled')).toBeUndefined()
  })

  it('opens profile settings on open click', async () => {
    const wrapper = mount(ChatMemoryChangeCard, {
      props: {
        call: {
          type: 'tool-call',
          toolCallId: 'c4',
          toolName: 'memory_add',
          input: { file: 'health.md', fact: 'Fact' },
          state: 'done',
        },
      },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          AppIcon: true,
          Button: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    })

    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')

    expect(mocks.goToConfig).toHaveBeenCalledWith('ai-profile:test-profile')
  })
})
