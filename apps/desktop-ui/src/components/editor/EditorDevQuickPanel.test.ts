import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivationMode } from '@tyco/shared'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import EditorDevQuickPanel from './EditorDevQuickPanel.vue'

vi.mock('../../stores/editor-input', () => ({
  useEditorInputStore: () => ({ selectedText: 'sample text', value: '' }),
}))

describe('EditorDevQuickPanel.vue', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop()
    desktop.backend.handle('activate_mode', () => undefined)
  })

  afterEach(() => desktop.dispose())

  it('renders quick buttons including styling and transform', () => {
    const wrapper = mount(EditorDevQuickPanel, {
      global: {
        plugins: [desktop.pinia],
        stubs: {
          AppIcon: true,
          Button: {
            props: ['title'],
            template:
              '<button class="dev-btn" :title="title"><slot /></button>',
          },
        },
      },
    })

    const stylingBtn = wrapper.find('button[title="Open Quick Styling"]')
    expect(stylingBtn.exists()).toBe(true)
    expect(stylingBtn.text()).toContain('Styling')

    const transformBtn = wrapper.find('button[title="Open Quick Transform"]')
    expect(transformBtn.exists()).toBe(true)
    expect(transformBtn.text()).toContain('Transform')
  })

  it('activates styling mode on click', async () => {
    const wrapper = mount(EditorDevQuickPanel, {
      global: {
        plugins: [desktop.pinia],
        stubs: {
          AppIcon: true,
          Button: {
            props: ['title'],
            template:
              '<button class="dev-btn" :title="title" @click="$attrs.onClick"><slot /></button>',
          },
        },
      },
    })

    const stylingBtn = wrapper.find('button[title="Open Quick Styling"]')
    await stylingBtn.trigger('click')

    await flushPromises()

    expect(desktop.backend.callsOf('activate_mode')).toEqual([
      { mode: ActivationMode.STYLING, text: 'sample text' },
    ])
  })

  it('activates transformation mode on click', async () => {
    const wrapper = mount(EditorDevQuickPanel, {
      global: {
        plugins: [desktop.pinia],
        stubs: {
          AppIcon: true,
          Button: {
            props: ['title'],
            template:
              '<button class="dev-btn" :title="title" @click="$attrs.onClick"><slot /></button>',
          },
        },
      },
    })

    const transformBtn = wrapper.find('button[title="Open Quick Transform"]')
    await transformBtn.trigger('click')

    await flushPromises()

    expect(desktop.backend.callsOf('activate_mode')).toEqual([
      { mode: ActivationMode.TRANSFORMATION, text: 'sample text' },
    ])
  })
})
