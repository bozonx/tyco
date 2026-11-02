import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import CustomTransformationMenu from './CustomTransformationMenu.vue'
import QueryPanel from './QueryPanel.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const invokeCall = vi.hoisted(() => vi.fn())
vi.mock('../../stores/invocations', () => ({
  useInvocationsStore: () => ({ call: invokeCall }),
}))

describe('CustomTransformationMenu', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
    invokeCall.mockReset()
    invokeCall.mockResolvedValue({
      ok: true,
      content: 'Transformed result',
      meta: { provider: 'llm', kind: 'llm' },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('renders TextPreview and QueryPanel with placeholder', () => {
    const wrapper = mount(CustomTransformationMenu, {
      props: { text: 'Some sample text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: {
            props: ['text'],
            template: '<div class="text-preview">{{ text }}</div>',
          },
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
        },
      },
    })

    expect(wrapper.find('.text-preview').text()).toBe('Some sample text')
    const queryPanel = wrapper.findComponent(QueryPanel)
    expect(queryPanel.exists()).toBe(true)
    expect(queryPanel.props('placeholder')).toBe('menu.aiPromptPlaceholder')
  })

  it('submits prompt and triggers core.transformation and diff modal', async () => {
    const wrapper = mount(CustomTransformationMenu, {
      props: { text: 'Some sample text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
        },
      },
    })

    const queryPanel = wrapper.findComponent(QueryPanel)
    queryPanel.vm.$emit('submit', {
      option: { label: 'Make it better' },
      ctrl: false,
    })
    await flushPromises()

    expect(invokeCall).toHaveBeenCalledWith(
      'core.transformation',
      'Some sample text',
      expect.objectContaining({ toolConfig: { prompt: 'Make it better' } })
    )

    const modalsStore = useMenuModalsStore()
    expect(modalsStore.currentModal).toBe(MenuModals.DIFF)
  })

  it('hides window on Escape when opened directly', async () => {
    const wrapper = mount(CustomTransformationMenu, {
      props: { text: 'Some sample text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            props: ['onEsc'],
            template:
              '<div class="layout"><button class="esc-btn" @click="onEsc">Esc</button><slot name="preview" /><slot name="actions" /></div>',
          },
        },
      },
    })
    await flushPromises()

    const queryPanel = wrapper.findComponent(QueryPanel)
    queryPanel.vm.$emit('back')
    await flushPromises()

    expect(
      desktop.backend.calls.some((call) => call.command === 'hide_window')
    ).toBe(true)
  })

  it('goes back on Escape when entered from another menu', async () => {
    const modalsStore = useMenuModalsStore()
    modalsStore.nextModal(MenuModals.INSERT, { text: 'Initial' })
    modalsStore.nextModal(MenuModals.CUSTOM_TRANSFORMATION, {
      text: 'Some sample text',
    })

    const wrapper = mount(CustomTransformationMenu, {
      props: { text: 'Some sample text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            props: ['onEsc'],
            template:
              '<div class="layout"><button class="esc-btn" @click="onEsc">Esc</button><slot name="preview" /><slot name="actions" /></div>',
          },
        },
      },
    })
    await flushPromises()

    const queryPanel = wrapper.findComponent(QueryPanel)
    queryPanel.vm.$emit('back')
    await flushPromises()

    expect(modalsStore.currentModal).toBe(MenuModals.INSERT)
  })

  it('inserts into editor with replacement on Tab', async () => {
    desktop.backend.handle('open_main_editor', () => undefined)

    const wrapper = mount(CustomTransformationMenu, {
      props: { text: 'Some sample text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
        },
      },
    })
    await flushPromises()

    const queryPanel = wrapper.findComponent(QueryPanel)
    const hints = queryPanel.props('hints') as Array<{
      keys: string[]
      label: string
      action?: () => void
    }>
    const tabHint = hints.find((h) => h.keys.includes('Tab'))
    expect(tabHint).toBeDefined()
    expect(tabHint?.label).toBe('shortcuts.insertIntoEditor')

    tabHint?.action?.()
    await flushPromises()

    expect(desktop.backend.callsOf('open_main_editor')).toEqual([
      { text: 'Some sample text', activationId: 0 },
    ])
  })
})
