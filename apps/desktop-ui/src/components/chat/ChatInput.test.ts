import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import ChatInput from './ChatInput.vue'

const mocks = vi.hoisted(() => ({
  addFiles: vi.fn(),
  setValue: vi.fn(),
  focus: vi.fn(),
  rememberSelection: vi.fn(),
  takePendingCaret: vi.fn(() => null),
  chatState: {
    attachedContext: [] as any[],
    addFiles: vi.fn(),
    addDroppedFiles: vi.fn(),
  },
  ipcState: { desktopState: { userConfig: {} as any } },
}))

vi.mock('../../stores/chat', () => ({ useChatStore: () => mocks.chatState }))

vi.mock('../../stores/chat-input', () => ({
  useChatInputStore: () =>
    reactive({
      value: 'Hello world',
      focusRequestCount: 0,
      requestFocus: mocks.focus,
      setValue: mocks.setValue,
      takePendingCaret: mocks.takePendingCaret,
      rememberSelection: mocks.rememberSelection,
    }),
}))

vi.mock('../../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../../test/desktop-store')
  return {
    useDesktopStore: () => mockDesktopStore(() => mocks.ipcState.desktopState),
  }
})

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ChatInput.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chatState.attachedContext = []
    mocks.ipcState.desktopState.userConfig = {}
  })

  describe('chat file paste', () => {
    it('attaches clipboard files that come without text', () => {
      const wrapper = mount(ChatInput)
      const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' })
      const event = new Event('paste', { cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [file], getData: () => '' },
      })
      wrapper.get('textarea').element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(mocks.chatState.addFiles).toHaveBeenCalledWith([file])
      wrapper.unmount()
    })

    it('pastes text copied from office apps without their picture of it', () => {
      const wrapper = mount(ChatInput)
      const file = new File(['pixels'], 'image.png', { type: 'image/png' })
      const event = new Event('paste', { cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [file], getData: () => 'Copied cells' },
      })
      wrapper.get('textarea').element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(mocks.addFiles).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('attaches files copied in a file manager by their paths', () => {
      const wrapper = mount(ChatInput)
      const event = new Event('paste', { cancelable: true })
      const types: Record<string, string> = {
        'text/plain': '/home/me/shot.png',
        'text/uri-list': 'file:///home/me/shot.png',
      }
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [], getData: (type: string) => types[type] || '' },
      })
      wrapper.get('textarea').element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(mocks.chatState.addDroppedFiles).toHaveBeenCalledWith([
        '/home/me/shot.png',
      ])
      wrapper.unmount()
    })

    it('leaves ordinary text paste to the textarea', () => {
      const wrapper = mount(ChatInput)
      const event = new Event('paste', { cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [], getData: () => 'Text' },
      })
      wrapper.get('textarea').element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(mocks.addFiles).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })

  describe('keyboard input and submit', () => {
    it('emits send on Enter key by default', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.get('textarea')

      await textarea.trigger('keydown', { key: 'Enter', code: 'Enter' })

      expect(wrapper.emitted('send')).toHaveLength(1)
      wrapper.unmount()
    })

    it('does not emit send on Shift+Enter and leaves line break to textarea', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.get('textarea')

      await textarea.trigger('keydown', {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
      })

      expect(wrapper.emitted('send')).toBeUndefined()
      wrapper.unmount()
    })

    it('emits send on Ctrl+Enter when submitKey is configured as ctrlEnter', async () => {
      mocks.ipcState.desktopState.userConfig = {
        editor: { submitKey: 'ctrlEnter' },
      }
      const wrapper = mount(ChatInput)
      const textarea = wrapper.get('textarea')

      // Bare Enter should NOT submit in ctrlEnter mode
      await textarea.trigger('keydown', { key: 'Enter', code: 'Enter' })
      expect(wrapper.emitted('send')).toBeUndefined()

      // Ctrl+Enter should submit
      await textarea.trigger('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
      })
      expect(wrapper.emitted('send')).toHaveLength(1)
      wrapper.unmount()
    })

    it('calls setValue when input event fires on textarea', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.get('textarea')

      await textarea.setValue('Updated question')

      expect(mocks.setValue).toHaveBeenCalledWith('Updated question')
      wrapper.unmount()
    })

    it('remembers cursor selection on blur', async () => {
      const wrapper = mount(ChatInput)
      const textarea = wrapper.get('textarea')
      const el = textarea.element as HTMLTextAreaElement
      el.selectionStart = 2
      el.selectionEnd = 5

      await textarea.trigger('blur')

      expect(mocks.rememberSelection).toHaveBeenCalledWith({ start: 2, end: 5 })
      wrapper.unmount()
    })

    it('shows context placeholder when attachedContext is present', () => {
      mocks.chatState.attachedContext = [{ text: 'context' }]
      const wrapper = mount(ChatInput)

      expect(wrapper.get('textarea').attributes('placeholder')).toBe(
        'chat.placeholderWithContext'
      )
      wrapper.unmount()
    })
  })
})
