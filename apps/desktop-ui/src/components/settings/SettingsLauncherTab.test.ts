import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import SettingsLauncherTab from './SettingsLauncherTab.vue'
import type { UserConfig } from '@tyco/shared'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

const cmd1 = { ...createCommand('script', 'cmd1'), name: 'Script 1' }
const cmd2 = { ...createCommand('webhook', 'cmd2'), name: 'Webhook 2' }

const mountTab = (launcherCommands: (string | null)[] = ['cmd1', null, 'cmd2']) =>
  mount(SettingsLauncherTab, {
    props: {
      userConfig: {
        commands: [cmd1, cmd2],
        launcherCommands,
      } as unknown as UserConfig,
    },
  })

describe('SettingsLauncherTab.vue', () => {
  it('renders 15 shortcut slots with configured commands', () => {
    const wrapper = mountTab()
    const slots = wrapper.findAll('.shortcut-slot')
    expect(slots).toHaveLength(15)
  })

  it('emits editCommand when pencil button is clicked', async () => {
    const wrapper = mountTab()
    const editBtn = wrapper.find('.shortcut-slot button[title="commands.editCommand"]')
    expect(editBtn.exists()).toBe(true)

    await editBtn.trigger('click')
    expect(wrapper.emitted('editCommand')?.[0]).toEqual(['cmd1'])
  })

  it('emits update:launcherCommands when a slot is cleared', async () => {
    const wrapper = mountTab()
    const deleteBtn = wrapper.find('.shortcut-slot .delete-btn')
    expect(deleteBtn.exists()).toBe(true)

    await deleteBtn.trigger('click')
    const emitted = wrapper.emitted('update:launcherCommands')?.[0]?.[0] as (string | null)[]
    expect(emitted).toBeDefined()
    expect(emitted[0]).toBeNull()
  })

  it('emits createCommand when choosing new script', async () => {
    const wrapper = mountTab()
    const select = wrapper.findComponent({ name: 'FieldSelect' })
    select.vm.$emit('update:value', 'new:script')

    expect(wrapper.emitted('createCommand')?.[0]).toEqual([0, 'script'])
  })
})
