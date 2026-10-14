import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { useChatFileDrop } from './use-chat-file-drop'
import type { FileDropEvent } from '../lib/chat/chat-file-drop-target'

const native = vi.hoisted(() => ({
  handler: undefined as
    undefined | ((event: { payload: FileDropEvent }) => void),
  cleanup: vi.fn(),
}))
vi.mock('../lib/desktop/window', () => ({
  getDesktopWebview: () => ({
    onDragDropEvent: async (handler: typeof native.handler) => {
      native.handler = handler
      return native.cleanup
    },
  }),
}))

it('clears an active drag when the selected model changes while dropping stays available', async () => {
  native.cleanup.mockClear()
  const modelId = ref('first')
  const accept = vi.fn(async () => {})
  const wrapper = mount(
    defineComponent({
      setup: () =>
        useChatFileDrop({
          getContext: () => [modelId.value],
          canAccept: () => true,
          accept,
        }),
      template: '<div ref="composerRef" :data-dragging="draggingFiles" />',
    })
  )
  try {
    await vi.waitFor(() => expect(native.handler).toBeTypeOf('function'))
    native.handler!({ payload: { type: 'enter', position: { x: 0, y: 0 } } })
    await nextTick()
    expect(wrapper.attributes('data-dragging')).toBe('true')
    modelId.value = 'second'
    await nextTick()
    expect(wrapper.attributes('data-dragging')).toBe('false')
  } finally {
    wrapper.unmount()
  }
  expect(native.cleanup).toHaveBeenCalledOnce()
})
