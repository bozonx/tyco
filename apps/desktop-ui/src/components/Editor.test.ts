import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Editor from './Editor.vue'

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const mockTypeIntoWindowAndClose = vi.fn()
vi.mock('../composables/useCallApi', () => ({
  useCallApi: () => ({ typeIntoWindowAndClose: mockTypeIntoWindowAndClose }),
}))

describe('Editor.vue toolbar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders Case and Format dropdowns in the left column and icon buttons in the right column', () => {
    const wrapper = mount(Editor, {
      global: {
        stubs: {
          Icon: true,
          EditorInput: true,
          DropdownMenu: {
            props: ['label', 'items'],
            template:
              '<div class="dropdown-stub" :data-label="label"><button>{{ label }}</button></div>',
          },
          Button: {
            props: ['title'],
            template:
              '<button class="btn-stub" :title="title"><slot /></button>',
          },
        },
      },
    })

    // Check dropdowns
    const dropdowns = wrapper.findAll('.dropdown-stub')
    expect(dropdowns).toHaveLength(2)
    expect(dropdowns[0].attributes('data-label')).toBe('editor.case')
    expect(dropdowns[1].attributes('data-label')).toBe('editor.format')

    // Check top right buttons: insertIntoWindow and translation
    const insertBtn = wrapper.find('button[title="action.insertIntoWindow"]')
    expect(insertBtn.exists()).toBe(true)

    const translateBtn = wrapper.find('button[title="action.translation"]')
    expect(translateBtn.exists()).toBe(true)
  })
})
