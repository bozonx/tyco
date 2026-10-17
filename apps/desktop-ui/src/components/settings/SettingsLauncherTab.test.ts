import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import SettingsLauncherTab from './SettingsLauncherTab.vue'
import {
  DEFAULT_USER_CONFIG,
  type LauncherPageConfig,
  type UserConfig,
} from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

const cmd1 = { ...createCommand('script', 'cmd1'), name: 'Script 1' }
const cmd2 = { ...createCommand('webhook', 'cmd2'), name: 'Webhook 2' }

const mountTab = (commandSlots: (string | null)[] = ['cmd1', null, 'cmd2']) =>
  mount(SettingsLauncherTab, {
    props: {
      userConfig: {
        ...structuredClone(DEFAULT_USER_CONFIG),
        commands: [cmd1, cmd2],
        launcherPages: [
          {
            id: 'main',
            slots: [...commandSlots, ...Array(15).fill(null)].slice(0, 15),
            inputMode: 'selection',
          },
        ],
      } as unknown as UserConfig,
    },
  })

describe('SettingsLauncherTab.vue', () => {
  it('adds an empty page and deletes the selected extra page', async () => {
    const wrapper = mountTab()
    const add = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.addLauncherPage')!
    await add.trigger('click')
    const pages = wrapper.emitted(
      'update:launcherPages'
    )?.[0]?.[0] as LauncherPageConfig[]
    expect(pages).toHaveLength(2)
    expect(pages[0]).toEqual(wrapper.props('userConfig').launcherPages[0])
    expect(pages[1]).toEqual({
      id: expect.any(String),
      slots: Array(15).fill(null),
      inputMode: 'selection',
    })
    await wrapper.setProps({
      userConfig: { ...wrapper.props('userConfig'), launcherPages: pages },
    })
    const remove = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.removeLauncherPage')!
    await remove.trigger('click')
    expect(wrapper.emitted('update:launcherPages')?.[1]?.[0]).toEqual([
      pages[0],
    ])
  })

  it('allows removing the first page but retains the final page', async () => {
    const wrapper = mountTab()
    const remove = () =>
      wrapper
        .findAll('button')
        .find((button) => button.text() === 'settings.removeLauncherPage')!
    expect(remove().attributes('disabled')).toBeDefined()
    const main = wrapper.props('userConfig').launcherPages[0]
    const other = {
      id: 'other',
      slots: Array<string | null>(15).fill(null),
      inputMode: 'none' as const,
    }
    await wrapper.setProps({
      userConfig: {
        ...wrapper.props('userConfig'),
        launcherPages: [main, other],
      },
    })
    expect(remove().attributes('disabled')).toBeUndefined()
    await remove().trigger('click')
    expect(wrapper.emitted('update:launcherPages')?.[0]?.[0]).toEqual([other])
  })

  it('renders 15 shortcut slots with configured commands', () => {
    const wrapper = mountTab()
    const slots = wrapper.findAll('.shortcut-slot')
    expect(slots).toHaveLength(15)
  })

  it('emits editCommand when pencil button is clicked', async () => {
    const wrapper = mountTab()
    const editBtn = wrapper.find(
      '.shortcut-slot button[title="commands.editCommand"]'
    )
    expect(editBtn.exists()).toBe(true)

    await editBtn.trigger('click')
    expect(wrapper.emitted('editCommand')?.[0]).toEqual(['cmd1'])
  })

  it('emits update:launcherPages when a slot is cleared', async () => {
    const wrapper = mountTab()
    const deleteBtn = wrapper.find('.shortcut-slot .delete-btn')
    expect(deleteBtn.exists()).toBe(true)

    await deleteBtn.trigger('click')
    const emitted = wrapper.emitted(
      'update:launcherPages'
    )?.[0]?.[0] as LauncherPageConfig[]
    expect(emitted).toBeDefined()
    expect(emitted[0].slots[0]).toBeNull()
  })

  it('does not include new script or new webhook in command options', () => {
    const wrapper = mountTab()
    const select = wrapper
      .find('.shortcut-slot')
      .findComponent({ name: 'FieldSelect' })
    const options = select.props('options') as { id: string }[]
    expect(options.some((o) => o.id === 'new:script')).toBe(false)
    expect(options.some((o) => o.id === 'new:webhook')).toBe(false)
  })

  it('renders page buttons with numbers and switches pages on click', async () => {
    const wrapper = mount(SettingsLauncherTab, {
      props: {
        userConfig: {
          ...structuredClone(DEFAULT_USER_CONFIG),
          commands: [cmd1, cmd2],
          launcherPages: [['cmd1'], ['cmd2'], [null]].map((slots, index) => ({
            id: `page-${index}`,
            slots,
            inputMode: 'selection',
          })),
        } as unknown as UserConfig,
      },
    })
    const buttons = wrapper.findAll('button')
    const page1Btn = buttons.find((b) => b.text() === '1')!
    const page2Btn = buttons.find((b) => b.text() === '2')!
    const page3Btn = buttons.find((b) => b.text() === '3')!

    expect(page1Btn.exists()).toBe(true)
    expect(page2Btn.exists()).toBe(true)
    expect(page3Btn.exists()).toBe(true)
    expect(page1Btn.classes()).toContain('btn-primary')
    expect(page2Btn.classes()).toContain('btn-neutral')

    await page2Btn.trigger('click')
    expect(page2Btn.classes()).toContain('btn-primary')
    expect(page1Btn.classes()).toContain('btn-neutral')
  })
})
