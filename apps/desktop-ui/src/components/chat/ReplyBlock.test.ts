import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import Diff from '../common/Diff.vue'
import ReplyBlock from './ReplyBlock.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

let desktop: TestDesktop
beforeEach(() => {
  desktop = installFakeDesktop()
  desktop.setState({ windowId: 'target' })
})
afterEach(() => desktop.dispose())

describe('ReplyBlock', () => {
  it('renders block title and text', () => {
    const wrapper = mount(ReplyBlock, {
      props: {
        block: {
          title: 'Formal variant',
          text: 'Good afternoon, here is the text.',
        },
      },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          Button: {
            template:
              '<button :data-action="icon" @click="$emit(\'click\')"><slot /></button>',
            props: ['icon', 'size', 'variant'],
          },
          CopyButton: {
            template: '<button class="copy-stub" />',
            props: ['value', 'label'],
          },
          Diff: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Formal variant')
    expect(wrapper.text()).toContain('Good afternoon, here is the text.')
  })

  it('emits insert and insertEditor events on button clicks', async () => {
    const wrapper = mount(ReplyBlock, {
      props: { block: { text: 'Replacement text' } },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          Button: {
            template: '<button class="btn-stub"><slot /></button>',
            props: ['icon', 'size', 'variant'],
          },
          CopyButton: true,
          Diff: true,
        },
      },
    })

    const buttons = wrapper.findAll('.btn-stub')
    await buttons[0].trigger('click')
    expect(wrapper.emitted('insert')?.[0]).toEqual(['Replacement text'])

    await buttons[1].trigger('click')
    expect(wrapper.emitted('insertEditor')?.[0]).toEqual(['Replacement text'])
  })

  it('shows diff toggle button only when originalText is different from block text', async () => {
    const wrapperWithoutDiff = mount(ReplyBlock, {
      props: { block: { text: 'Same text' }, originalText: 'Same text' },
      global: {
        plugins: [desktop.pinia],
        stubs: { Button: true, CopyButton: true, Diff: true },
      },
    })
    expect(wrapperWithoutDiff.findComponent(Diff).exists()).toBe(false)

    const wrapperWithDiff = mount(ReplyBlock, {
      props: { block: { text: 'New text' }, originalText: 'Original text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          Button: { template: '<button class="btn-stub"><slot /></button>' },
          CopyButton: true,
          Diff: {
            name: 'Diff',
            template: '<div class="diff-stub" />',
            props: ['oldText', 'newText', 'mode'],
          },
        },
      },
    })

    const diffButton = wrapperWithDiff.findAll('.btn-stub')[2]
    expect(diffButton.exists()).toBe(true)

    await diffButton.trigger('click')
    expect(wrapperWithDiff.find('.diff-stub').exists()).toBe(true)
  })

  it('names the target application and cannot insert without a window', async () => {
    const mountBlock = () =>
      mount(ReplyBlock, {
        props: { block: { text: 'Text' } },
        global: {
          plugins: [desktop.pinia],
          stubs: {
            Button: {
              template:
                '<button class="btn-stub" :disabled="disabled"><slot /></button>',
              props: ['icon', 'size', 'variant', 'disabled'],
            },
            CopyButton: true,
            Diff: true,
          },
        },
      })
    desktop.setState({ windowId: 'target', windowAppName: 'Firefox' })
    const named = mountBlock()
    expect(named.findAll('.btn-stub')[0].text()).toBe('action.insertIntoApp')
    expect(named.findAll('.btn-stub')[0].attributes('disabled')).toBeUndefined()

    desktop.setState({ windowId: null, windowAppName: undefined })
    const closed = mountBlock()
    expect(closed.findAll('.btn-stub')[0].attributes('disabled')).toBeDefined()
    expect(closed.findAll('.btn-stub')[0].attributes('title')).toBe(
      'menu.noInsertTarget'
    )
  })
})
