import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from './ChatInput.vue'

const mocks = vi.hoisted(() => ({ addFiles: vi.fn(), setValue: vi.fn() }))
vi.mock('../stores/chat', () => ({
  useChatStore: () => ({ attachedContext: [], addFiles: mocks.addFiles }),
}))
vi.mock('../stores/chatInput', () => ({
  useChatInputStore: () => ({
    value: 'Hello world',
    focus: vi.fn(),
    setValue: mocks.setValue,
    takePendingCaret: () => null,
  }),
}))
vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({ params: { userConfig: {} } }),
}))
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('chat file paste', () => {
  beforeEach(() => vi.clearAllMocks())
  it('attaches clipboard files and inserts accompanying text at the caret', () => {
    const wrapper = mount(ChatInput)
    const textarea = wrapper.get('textarea').element
    textarea.setSelectionRange(6, 11)
    const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' })
    const event = new Event('paste', { cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [file], getData: () => 'image' },
    })
    textarea.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(mocks.addFiles).toHaveBeenCalledWith([file])
    expect(mocks.setValue).toHaveBeenCalledWith('Hello image')
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
