import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { slotsFromList } from '../../lib/shortcut-slots/shortcut-slots'
import { nextTick } from 'vue'

import { createCommand } from '../../lib/commands/command-config'
import { createTestSettingsContext } from '../../test/settings-context'
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

let context: ReturnType<typeof createTestSettingsContext>

const mountWith = (config: Partial<UserConfig>) => {
  context = createTestSettingsContext({
    ...structuredClone(DEFAULT_USER_CONFIG),
    commands: [cmd1, cmd2],
    ...config,
  } as Partial<UserConfig>)
  return mount(SettingsLauncherTab, { global: { provide: context.provide } })
}

const mountTab = (commandSlots: (string | null)[] = ['cmd1', null, 'cmd2']) =>
  mountWith({
    launcherPages: [
      {
        id: 'main',
        inputMode: 'selection',
        hotkey: '',
        slots: slotsFromList(commandSlots),
      },
    ],
  })

const pages = () => context.draft.value.launcherPages

describe('SettingsLauncherTab.vue', () => {
  it('adds an empty page and deletes the selected extra page', async () => {
    const wrapper = mountTab()
    const add = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.addLauncherPage')!
    await add.trigger('click')
    const [main] = pages()
    expect(pages()).toHaveLength(2)
    expect(pages()[1]).toEqual({
      id: expect.any(String),
      inputMode: 'selection',
      hotkey: '',
      slots: {},
    })
    await nextTick()
    const remove = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.removeLauncherPage')!
    await remove.trigger('click')
    expect(pages()).toEqual([main])
  })

  it('allows removing the first page but retains the final page', async () => {
    const wrapper = mountTab()
    const remove = () =>
      wrapper
        .findAll('button')
        .find((button) => button.text() === 'settings.removeLauncherPage')!
    expect(remove().attributes('disabled')).toBeDefined()
    const other: LauncherPageConfig = {
      id: 'other',
      inputMode: 'none',
      hotkey: '',
      slots: {},
    }
    context.draft.value.launcherPages = [pages()[0], other]
    await nextTick()
    expect(remove().attributes('disabled')).toBeUndefined()
    await remove().trigger('click')
    expect(pages()).toEqual([other])
  })

  it('renders 15 shortcut slots with configured commands', () => {
    const wrapper = mountTab()
    const slots = wrapper.findAll('.shortcut-slot')
    expect(slots).toHaveLength(15)
  })

  it('opens a command from its pencil button', async () => {
    const wrapper = mountTab()
    const editBtn = wrapper.find(
      '.shortcut-slot button[title="commands.editCommand"]'
    )
    expect(editBtn.exists()).toBe(true)

    await editBtn.trigger('click')
    expect(context.editCommand).toHaveBeenCalledWith('cmd1')
  })

  it('clears a slot of the page', async () => {
    const wrapper = mountTab()
    const deleteBtn = wrapper.find('.shortcut-slot .delete-btn')
    expect(deleteBtn.exists()).toBe(true)

    await deleteBtn.trigger('click')
    expect(pages()[0].slots.q).toBeUndefined()
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
    const wrapper = mountWith({
      launcherPages: [{ q: 'cmd1' }, { q: 'cmd2' }, {}].map((slots, index) => ({
        id: `page-${index}`,
        inputMode: 'selection' as const,
        hotkey: '',
        slots,
      })),
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
