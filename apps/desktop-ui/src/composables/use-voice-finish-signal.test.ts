import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useVoiceFinishSignal } from './use-voice-finish-signal'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  shortcutLabel: vi.fn((mode: string) => (mode === 'voice' ? 'Ctrl+V' : '')),
}))

vi.mock('../stores/global-hotkeys', () => ({
  useGlobalHotkeysStore: () => ({
    load: mocks.load,
    shortcutLabel: mocks.shortcutLabel,
  }),
}))

describe('useVoiceFinishSignal', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop({
      activation: { activationId: 7 },
      window: { isWindowShown: true },
    })
  })

  afterEach(() => desktop.dispose())

  const mountSignal = (mode: () => string | undefined, confirm: () => void) => {
    let label: { value: string } | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          label = useVoiceFinishSignal(mode, confirm)
          return () => null
        },
      }),
      { global: { plugins: [desktop.pinia] } }
    )
    return { wrapper, label: label! }
  }

  const finish = async (activationId: number) => {
    await desktop.emit(DESKTOP_EVENTS.VOICE_FINISH, activationId)
    await flushPromises()
  }

  it('confirms only the shown current activation and labels its hotkey', async () => {
    const confirm = vi.fn()
    const { wrapper, label } = mountSignal(() => 'voice', confirm)
    await flushPromises()
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(label.value).toBe('Ctrl+V')

    await finish(6)
    expect(confirm).not.toHaveBeenCalled()
    desktop.setState({ isWindowShown: false })
    await finish(7)
    expect(confirm).not.toHaveBeenCalled()
    desktop.setState({ isWindowShown: true })
    await finish(7)
    expect(confirm).toHaveBeenCalledOnce()

    wrapper.unmount()
    await flushPromises()
    await finish(7)
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('stays off without an activation mode', async () => {
    const confirm = vi.fn()
    const { wrapper, label } = mountSignal(() => undefined, confirm)
    await flushPromises()
    expect(label.value).toBe('')
    await finish(7)
    expect(confirm).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
