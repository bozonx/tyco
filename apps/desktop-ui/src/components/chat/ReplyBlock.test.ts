import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Diff from '../common/Diff.vue'
import ReplyBlock from './ReplyBlock.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

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
      props: {
        block: {
          text: 'Replacement text',
        },
      },
      global: {
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
      props: {
        block: { text: 'Same text' },
        originalText: 'Same text',
      },
      global: {
        stubs: { Button: true, CopyButton: true, Diff: true },
      },
    })
    expect(wrapperWithoutDiff.findComponent(Diff).exists()).toBe(false)

    const wrapperWithDiff = mount(ReplyBlock, {
      props: {
        block: { text: 'New text' },
        originalText: 'Original text',
      },
      global: {
        stubs: {
          Button: {
            template: '<button class="btn-stub"><slot /></button>',
          },
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
})
