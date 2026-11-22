import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import DialogLanguageRoute from './DialogLanguageRoute.vue'

describe('DialogLanguageRoute.vue', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
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

  it('renders trigger button and opens language panel without model indication', async () => {
    const wrapper = mount(DialogLanguageRoute, {
      global: { plugins: [i18n] },
      attachTo: document.body,
    })

    const button = wrapper.find('button.dialog-route-trigger')
    expect(button.exists()).toBe(true)

    await button.trigger('click')

    const panel = document.body.querySelector('.dialog-route-panel')
    expect(panel).not.toBeNull()

    // Model indication must not be present
    expect(document.body.querySelector('.dialog-route-model')).toBeNull()

    // Own language select includes the default language name
    const selects = panel!.querySelectorAll('select')
    expect(selects.length).toBeGreaterThan(0)

    // The ownLanguage select options
    const ownLanguageSelect = selects[selects.length - 1]
    const firstOption = ownLanguageSelect.querySelector('option')
    expect(firstOption?.textContent).toContain('Russian')

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
      attachTo: document.body,
    })

    await wrapper.find('button.dialog-route-trigger').trigger('click')

    const panel = document.body.querySelector('.dialog-route-panel')
    const selects = panel!.querySelectorAll('select')
    const ownLanguageSelect = selects[selects.length - 1]
    const firstOption = ownLanguageSelect.querySelector('option')
    expect(firstOption?.textContent).toContain('Auto')

    wrapper.unmount()
  })
})
