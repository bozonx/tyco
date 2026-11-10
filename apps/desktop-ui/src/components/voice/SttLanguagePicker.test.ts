import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import { useDesktopStore } from '../../stores/desktop'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import SttLanguagePicker from './SttLanguagePicker.vue'

describe('SttLanguagePicker', () => {
  let desktop: TestDesktop

  afterEach(() => desktop?.dispose())

  it('renders only when the STT provider is deepgram', async () => {
    desktop = await loadFakeDesktop({
      userConfig: {
        ...DEFAULT_USER_CONFIG,
        stt: { ...DEFAULT_USER_CONFIG.stt, provider: 'geminiLive' },
      },
    })
    const wrapper = mount(SttLanguagePicker, {
      global: { plugins: [i18n, desktop.pinia] },
    })
    expect(wrapper.find('button').exists()).toBe(false)

    useDesktopStore().desktopState.userConfig.stt.provider = 'sherpaOnnx'
    await flushPromises()
    expect(wrapper.find('button').exists()).toBe(false)

    useDesktopStore().desktopState.userConfig.stt.provider = 'deepgram'
    await flushPromises()
    expect(wrapper.find('button').exists()).toBe(true)
    wrapper.unmount()
  })

  it('persists selected language into userConfig.stt.providers.deepgram.language and emits change', async () => {
    desktop = await loadFakeDesktop({
      userConfig: {
        ...DEFAULT_USER_CONFIG,
        stt: {
          ...DEFAULT_USER_CONFIG.stt,
          provider: 'deepgram',
          providers: {
            ...DEFAULT_USER_CONFIG.stt.providers,
            deepgram: { modelId: 'nova-3', language: 'auto' },
          },
        },
      },
    })
    const wrapper = mount(SttLanguagePicker, {
      global: { plugins: [i18n, desktop.pinia] },
      attachTo: document.body,
    })

    await wrapper.find('button.dropdown-trigger').trigger('click')
    await flushPromises()

    const ruLabel = i18n.global.t('language.ru-RU')
    const items = Array.from(
      document.body.querySelectorAll('[role="menuitem"]')
    )
    const ruButton = items.find((el) => el.textContent?.includes(ruLabel)) as
      HTMLButtonElement | undefined
    expect(ruButton).toBeDefined()
    ruButton!.click()
    await flushPromises()

    expect(desktop.backend.userConfig.stt.providers.deepgram.language).toBe(
      'ru-RU'
    )
    expect(wrapper.emitted('change')).toEqual([['ru-RU']])
    expect(wrapper.find('button.dropdown-trigger').text()).toContain('RU')
    wrapper.unmount()
  })

  it('opens Transcription settings tab from the menu footer item', async () => {
    desktop = await loadFakeDesktop({
      userConfig: {
        ...DEFAULT_USER_CONFIG,
        stt: { ...DEFAULT_USER_CONFIG.stt, provider: 'deepgram' },
      },
    })
    const activateMode = vi.fn()
    desktop.backend.handle('activate_mode', activateMode)

    const wrapper = mount(SttLanguagePicker, {
      global: { plugins: [i18n, desktop.pinia] },
      attachTo: document.body,
    })

    await wrapper.find('button.dropdown-trigger').trigger('click')
    await flushPromises()

    const settingsLabel = i18n.global.t('stt.openSettings')
    const items = Array.from(
      document.body.querySelectorAll('[role="menuitem"]')
    )
    const settingsBtn = items.find((el) =>
      el.textContent?.includes(settingsLabel)
    ) as HTMLButtonElement | undefined
    expect(settingsBtn).toBeDefined()
    settingsBtn!.click()
    await flushPromises()

    expect(activateMode).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'config', settingsTab: 'stt' })
    )
    wrapper.unmount()
  })
})
