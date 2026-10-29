import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivationMode } from '@tyco/shared'
import EditorDevQuickPanel from './EditorDevQuickPanel.vue'

const { call } = vi.hoisted(() => ({
  call: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ call }),
}))

vi.mock('../../stores/editor-input', () => ({
  useEditorInputStore: () => ({
    selectedText: 'sample text',
    value: '',
  }),
}))

describe('EditorDevQuickPanel.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders quick buttons including styling and transform', () => {
    const wrapper = mount(EditorDevQuickPanel, {
      global: {
        stubs: {
          AppIcon: true,
          Button: {
            props: ['title'],
            template: '<button class="dev-btn" :title="title"><slot /></button>',
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
        stubs: {
          AppIcon: true,
          Button: {
            props: ['title'],
            template: '<button class="dev-btn" :title="title" @click="$attrs.onClick"><slot /></button>',
          },
        },
      },
    })

    const stylingBtn = wrapper.find('button[title="Open Quick Styling"]')
    await stylingBtn.trigger('click')

    expect(call).toHaveBeenCalledWith('activate_mode', {
      mode: ActivationMode.STYLING,
      text: 'sample text',
    })
  })

  it('activates transformation mode on click', async () => {
    const wrapper = mount(EditorDevQuickPanel, {
      global: {
        stubs: {
          AppIcon: true,
          Button: {
            props: ['title'],
            template: '<button class="dev-btn" :title="title" @click="$attrs.onClick"><slot /></button>',
          },
        },
      },
    })

    const transformBtn = wrapper.find('button[title="Open Quick Transform"]')
    await transformBtn.trigger('click')

    expect(call).toHaveBeenCalledWith('activate_mode', {
      mode: ActivationMode.TRANSFORMATION,
      text: 'sample text',
    })
  })
})
