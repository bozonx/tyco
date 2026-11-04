import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const enUS: Record<string, string> = {
  'common.linesCount': 'Lines: {count}',
  'common.charsCount': 'Characters: {count}',
  'common.expandInEditor': 'Open in full editor',
  'common.editorModalTitle': 'Text editor',
  'common.done': 'Done',
  'common.close': 'Close',
}

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, ...rest: any[]) => {
      const template = enUS[key] ?? key
      const params = rest.find((arg) => typeof arg === 'object' && arg !== null)
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          template
        )
      }
      return template
    },
  }),
}))

import FieldPromptTextArea from './FieldPromptTextArea.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
      this.querySelector<HTMLButtonElement>('[autofocus]')?.focus()
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})

describe('FieldPromptTextArea', () => {
  it('renders FieldTextArea and the expand icon button', () => {
    const wrapper = mount(FieldPromptTextArea, {
      props: {
        modelValue: 'Initial prompt text',
        placeholder: 'Enter prompt...',
      },
    })

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      'Initial prompt text'
    )

    const expandBtn = wrapper.find('.field-prompt-expand-btn')
    expect(expandBtn.exists()).toBe(true)
  })

  it('opens full window modal on expand button click and updates model value', async () => {
    const wrapper = mount(FieldPromptTextArea, {
      attachTo: document.body,
      props: { modelValue: 'Line 1\nLine 2', placeholder: 'System prompt' },
    })

    const expandBtn = wrapper.find('.field-prompt-expand-btn')
    await expandBtn.trigger('click')
    await nextTick()

    const modalTextarea = document.querySelector<HTMLTextAreaElement>(
      '.field-prompt-modal-textarea'
    )
    expect(modalTextarea).not.toBeNull()
    expect(modalTextarea?.value).toBe('Line 1\nLine 2')

    // Check stats (2 lines, 13 characters)
    const stats = document.querySelector('.field-prompt-modal-stats')
    expect(stats?.textContent).toContain('2')
    expect(stats?.textContent).toContain('13')

    // Simulate typing in modal
    if (modalTextarea) {
      modalTextarea.value = 'Updated line 1\nLine 2'
      modalTextarea.dispatchEvent(new Event('input'))
    }

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      'Updated line 1\nLine 2',
    ])

    // Close modal via Done button
    const buttons = Array.from(document.querySelectorAll('button'))
    const doneButton = buttons.find((b) => b.textContent?.includes('Done'))
    expect(doneButton).toBeDefined()
    doneButton?.click()
    await nextTick()

    expect(document.querySelector('.field-prompt-modal-textarea')).toBeNull()

    wrapper.unmount()
  })

  it('exposes text control methods and forwards them to inner textarea', () => {
    const wrapper = mount(FieldPromptTextArea, {
      attachTo: document.body,
      props: { modelValue: 'Test prompt text' },
    })

    wrapper.vm.focus()
    expect(wrapper.vm.isFocused()).toBe(true)

    wrapper.vm.select(0, 4)
    expect(wrapper.vm.getSelection()).toEqual({ start: 0, end: 4 })

    wrapper.unmount()
  })
})
