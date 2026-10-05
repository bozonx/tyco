import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import SettingsCommandsTab from './SettingsCommandsTab.vue'
import type { UserConfig } from '@tyco/shared'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const removeSecret = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/llm', () => ({ useLlmStore: () => ({ removeSecret }) }))
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

const webhook = {
  ...createCommand('webhook', 'wh1'),
  name: 'Hook',
  toolConfig: { url: 'https://x.test', authSecret: true, takesText: true },
}
const script = { ...createCommand('script', 'sc1'), name: 'Backup' }

const mountTab = (focusCommandId?: string) =>
  mount(SettingsCommandsTab, {
    props: {
      userConfig: {
        commands: [webhook, script],
        mainActions: [
          { type: 'command', commandId: 'wh1' },
          { type: 'standard', actionId: 'translation' },
        ],
      } as unknown as UserConfig,
      focusCommandId,
    },
    global: { stubs: { CommandEditor: true } },
  })

describe('SettingsCommandsTab.vue', () => {
  it('lists the commands and marks the ones in the menu', () => {
    const wrapper = mountTab()
    const cards = wrapper.findAll('.command-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('Hook')
    expect(cards[0].text()).toContain('commands.badgeInMenu')
    expect(cards[1].text()).not.toContain('commands.badgeInMenu')
  })

  it('opens the editor of the focused command', () => {
    const wrapper = mountTab('sc1')
    const cards = wrapper.findAll('.command-card')
    expect(cards[0].find('.command-body').exists()).toBe(false)
    expect(cards[1].find('.command-body').exists()).toBe(true)
  })

  it('adds a new command of the chosen tool', async () => {
    const wrapper = mountTab()
    await wrapper.findAll('.add-btn')[1].trigger('click')
    const [commands] = wrapper.emitted('update:commands')![0] as [
      { toolId: string }[],
    ]
    expect(commands.map((command) => command.toolId)).toEqual([
      'webhook',
      'script',
      'webhook',
    ])
  })

  it('keeps a command whose removal is not confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountTab()
    await wrapper.findAll('.delete-btn')[0].trigger('click')
    expect(confirm).toHaveBeenCalledWith('commands.removeConfirmSecret')
    expect(wrapper.emitted('update:commands')).toBeUndefined()
    expect(removeSecret).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('removes a command with its menu items and its webhook token', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountTab()
    await wrapper.findAll('.delete-btn')[0].trigger('click')
    confirm.mockRestore()

    const [commands] = wrapper.emitted('update:commands')![0] as [
      { id: string }[],
    ]
    expect(commands.map((command) => command.id)).toEqual(['sc1'])
    expect(wrapper.emitted('update:mainActions')![0]).toEqual([
      [null, { type: 'standard', actionId: 'translation' }],
    ])
    expect(removeSecret).toHaveBeenCalledWith('webhook-wh1')
  })
})
