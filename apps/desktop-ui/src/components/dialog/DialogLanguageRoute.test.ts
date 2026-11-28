import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import DialogLanguageRoute from './DialogLanguageRoute.vue'

describe('DialogLanguageRoute.vue', () => {
  let desktop: TestDesktop
  let container: HTMLDivElement

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    desktop = await loadFakeDesktop({
      userConfig: {
        ...DEFAULT_USER_CONFIG,
        stt: {
          ...DEFAULT_USER_CONFIG.stt,
          provider: 'deepgram',
          providers: {
            ...DEFAULT_USER_CONFIG.stt.providers,
            deepgram: {
              ...DEFAULT_USER_CONFIG.stt.providers.deepgram,
              language: 'ru',
            },
          },
        },
        dialog: {
          ...DEFAULT_USER_CONFIG.dialog,
          isEnabled: true,
          ownLanguage: '',
        },
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
    document.body.innerHTML = ''
  })

  it('renders trigger button and opens language panel without model indication', async () => {
    const wrapper = mount(DialogLanguageRoute, {
      global: { plugins: [i18n] },
      attachTo: container,
    })

    const button = wrapper.find('button.dialog-route-trigger')
    expect(button.exists()).toBe(true)

    await button.trigger('click')

    const panel = document.body.querySelector('.dialog-route-panel')
    expect(panel).not.toBeNull()

    // Model indication must not be present
    expect(document.body.querySelector('.dialog-route-model')).toBeNull()

    const ownLanguageSelect =
      panel!.querySelectorAll<HTMLButtonElement>('[role="combobox"]')
    expect([...ownLanguageSelect].at(-1)?.textContent).toContain('Russian')

    wrapper.unmount()
  })

  it('displays Auto when STT language is not set or multi', async () => {
    desktop.setUserConfig({
      stt: {
        ...desktop.backend.userConfig.stt,
        providers: {
          ...desktop.backend.userConfig.stt.providers,
          deepgram: {
            ...desktop.backend.userConfig.stt.providers.deepgram,
            language: 'multi',
          },
        },
      },
    })

    const wrapper = mount(DialogLanguageRoute, {
      global: { plugins: [i18n] },
      attachTo: container,
    })

    await wrapper.find('button.dialog-route-trigger').trigger('click')

    const panel = document.body.querySelector('.dialog-route-panel')
    const ownLanguageSelect =
      panel!.querySelectorAll<HTMLButtonElement>('[role="combobox"]')
    expect([...ownLanguageSelect].at(-1)?.textContent).toContain('Auto')

    wrapper.unmount()
  })

  it('renders show translation only checkbox and toggles it', async () => {
    desktop.setUserConfig({
      dialog: {
        ...desktop.backend.userConfig.dialog,
        translationTargetLanguage: 'ru-RU',
        isTranslationOnly: false,
      },
    })

    const wrapper = mount(DialogLanguageRoute, {
      global: { plugins: [i18n] },
      attachTo: container,
    })

    expect(wrapper.find('button.dialog-route-trigger').text()).toContain(
      'AUTO → RU / RU'
    )

    await wrapper.find('button.dialog-route-trigger').trigger('click')

    const checkbox = document.body.querySelector(
      '.dialog-route-panel input[type="checkbox"]'
    ) as HTMLInputElement | null
    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(false)
    expect(checkbox?.disabled).toBe(false)

    checkbox?.click()

    expect(desktop.backend.userConfig.dialog.isTranslationOnly).toBe(true)

    wrapper.unmount()
  })

  it('hides own language and formats trigger without own language when Gemini Live is used', async () => {
    desktop.setUserConfig({
      stt: { ...desktop.backend.userConfig.stt, provider: 'geminiLive' },
      dialog: {
        ...desktop.backend.userConfig.dialog,
        translationTargetLanguage: 'ru-RU',
      },
    })

    const wrapper = mount(DialogLanguageRoute, {
      global: { plugins: [i18n] },
      attachTo: container,
    })

    expect(wrapper.find('button.dialog-route-trigger').text()).toContain(
      'AUTO → RU'
    )

    await wrapper.find('button.dialog-route-trigger').trigger('click')

    const panel = document.body.querySelector('.dialog-route-panel')
    expect(panel?.textContent).not.toContain(
      i18n.global.t('dialog.ownLanguage')
    )

    wrapper.unmount()
  })
})
