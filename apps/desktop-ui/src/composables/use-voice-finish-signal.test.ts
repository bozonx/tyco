import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'

import { useVoiceFinishSignal } from './use-voice-finish-signal'
import { DESKTOP_EVENTS } from '@tyco/shared'

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  unlisten: vi.fn(),
  load: vi.fn(),
  shortcutLabel: vi.fn((mode: string) => (mode === 'voice' ? 'Ctrl+V' : '')),
}))
const desktopState = reactive({ activationId: 7, isWindowShown: true })

vi.mock('../lib/desktop/client', () => ({
  desktopClient: { listen: mocks.listen },
}))
vi.mock('../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../test/desktop-store')
  return { useDesktopStore: () => mockDesktopStore(() => desktopState) }
})
vi.mock('../stores/global-hotkeys', () => ({
  useGlobalHotkeysStore: () => ({
    load: mocks.load,
    shortcutLabel: mocks.shortcutLabel,
  }),
}))

const mountSignal = (mode: () => string | undefined, confirm: () => void) => {
  let label: { value: string } | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        label = useVoiceFinishSignal(mode, confirm)
        return () => null
      },
    })
  )
  return { wrapper, label: label! }
}
const emitFinish = (activationId: number) => {
  const [event, handler] = mocks.listen.mock.calls[0]!
  expect(event).toBe(DESKTOP_EVENTS.VOICE_FINISH)
  ;(handler as (id: number) => void)(activationId)
}

describe('useVoiceFinishSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listen.mockResolvedValue(mocks.unlisten)
    desktopState.activationId = 7
    desktopState.isWindowShown = true
  })

  it('confirms only the shown current activation and labels its hotkey', async () => {
    const confirm = vi.fn()
    const { wrapper, label } = mountSignal(() => 'voice', confirm)
    await flushPromises()
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(label.value).toBe('Ctrl+V')

    emitFinish(6)
    expect(confirm).not.toHaveBeenCalled()
    desktopState.isWindowShown = false
    emitFinish(7)
    expect(confirm).not.toHaveBeenCalled()
    desktopState.isWindowShown = true
    emitFinish(7)
    expect(confirm).toHaveBeenCalledOnce()

    wrapper.unmount()
    expect(mocks.unlisten).toHaveBeenCalledOnce()
  })

  it('stays off without an activation mode', async () => {
    const confirm = vi.fn()
    const { wrapper, label } = mountSignal(() => undefined, confirm)
    await flushPromises()
    expect(label.value).toBe('')
    emitFinish(7)
    expect(confirm).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
