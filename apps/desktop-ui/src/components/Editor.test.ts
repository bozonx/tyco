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

    // Check top right buttons: AI task, translation and insertIntoWindow
    const aiTaskBtn = wrapper.find('button[title="action.aiTask"]')
    expect(aiTaskBtn.exists()).toBe(true)

    const translateBtn = wrapper.find('button[title="action.translation"]')
    expect(translateBtn.exists()).toBe(true)

    const insertBtn = wrapper.find('button[title="action.insertIntoWindow"]')
    expect(insertBtn.exists()).toBe(true)

    const rightColumn = wrapper.findAll(
      '.flex.items-center.justify-between > .flex.items-center'
    )[1]
    const rightButtons = rightColumn.findAll('.btn-stub')
    const titles = rightButtons.map((btn) => btn.attributes('title'))
    expect(titles).toEqual([
      'action.aiTask',
      'action.translation',
      'action.insertIntoWindow',
    ])
  })

  it('renders plugin toolbar buttons in left and right positions', async () => {
    const { useToolbarStore } = await import('../stores/toolbar')
    const toolbarStore = useToolbarStore()

    toolbarStore.registerToolbarItems([
      {
        id: 'left-tool',
        icon: 'mdi:hammer',
        position: 'left',
        tooltipKey: 'tool.left',
        action: vi.fn(),
      },
      {
        id: 'right-tool',
        icon: 'mdi:star',
        position: 'right',
        tooltipKey: 'tool.right',
        action: vi.fn(),
      },
    ])

    const wrapper = mount(Editor, {
      global: {
        stubs: {
          Icon: true,
          EditorInput: true,
          DropdownMenu: true,
          Button: {
            props: ['title'],
            template:
              '<button class="btn-stub" :title="title"><slot /></button>',
          },
        },
      },
    })

    const leftBtn = wrapper.find('button[title="tool.left"]')
    expect(leftBtn.exists()).toBe(true)

    const rightBtn = wrapper.find('button[title="tool.right"]')
    expect(rightBtn.exists()).toBe(true)
  })

  it('includes registered plugin case and format items in dropdowns', async () => {
    const { useEditMenuStore } = await import('../stores/editMenu')
    const editMenuStore = useEditMenuStore()

    editMenuStore.registerCaseItems([
      { id: 'custom-case', labelKey: 'edit.customCase', action: vi.fn() },
    ])

    editMenuStore.registerFormatItems([
      { id: 'custom-format', labelKey: 'edit.customFormat', action: vi.fn() },
    ])

    let caseItemsPassed: any[] = []
    let formatItemsPassed: any[] = []

    mount(Editor, {
      global: {
        stubs: {
          Icon: true,
          EditorInput: true,
          Button: true,
          DropdownMenu: {
            props: ['label', 'items'],
            setup(props) {
              if (props.label === 'editor.case') {
                caseItemsPassed = props.items as any[]
              }
              if (props.label === 'editor.format') {
                formatItemsPassed = props.items as any[]
              }
              return () => null
            },
          },
        },
      },
    })

    expect(
      caseItemsPassed.some((item) => item.label === 'edit.customCase')
    ).toBe(true)
    expect(
      formatItemsPassed.some((item) => item.label === 'edit.customFormat')
    ).toBe(true)
  })
})
