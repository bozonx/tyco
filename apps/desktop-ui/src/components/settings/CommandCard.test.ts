import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG, type CommandConfig } from '@tyco/shared'

import { createCommand } from '../../lib/commands/command-config'
import AppIcon from '../common/AppIcon.vue'
import CommandCard from './CommandCard.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

vi.mock('../../stores/operations', async () => {
  const { testOperations } = await import('../../lib/operations/testing')
  const tools = testOperations()
  return { useOperationsStore: () => tools }
})

const defaultCommand: CommandConfig = {
  ...createCommand('script', 'sc1'),
  name: 'My Script',
  isVoiceEnabled: false,
  isAvailableExternally: false,
  description: '',
}

const mountCard = (command: Partial<CommandConfig> = {}) =>
  mount(CommandCard, {
    props: {
      command: { ...defaultCommand, ...command },
      userConfig: DEFAULT_USER_CONFIG,
      expanded: false,
      launcherSlots: [],
      nameConflicts: [],
    },
    global: { stubs: { CommandEditor: true } },
  })

describe('CommandCard.vue', () => {
  it('does not display badgeNoText for standalone commands', () => {
    const wrapper = mountCard()
    expect(wrapper.text()).not.toContain('commands.badgeNoText')
    expect(wrapper.find('.command-triggers').exists()).toBe(false)
  })

  it('displays voice badge when voice is enabled', () => {
    const wrapper = mountCard({ isVoiceEnabled: true })
    const triggers = wrapper.find('.command-triggers')
    expect(triggers.exists()).toBe(true)
    const voiceBadge = triggers.find('[title="commands.badgeVoice"]')
    expect(voiceBadge.exists()).toBe(true)
    expect(voiceBadge.findComponent(AppIcon).props('icon')).toBe(
      'mdi:microphone-outline'
    )
  })

  it('displays external badge when external access is enabled', () => {
    const wrapper = mountCard({ isAvailableExternally: true })
    const triggers = wrapper.find('.command-triggers')
    expect(triggers.exists()).toBe(true)
    const externalBadge = triggers.find('[title="commands.badgeExternal"]')
    expect(externalBadge.exists()).toBe(true)
    expect(externalBadge.findComponent(AppIcon).props('icon')).toBe(
      'mdi:console-line'
    )
  })

  it('displays AI badge when description is provided', () => {
    const wrapper = mountCard({ description: 'Performs automated diagnostics' })
    const triggers = wrapper.find('.command-triggers')
    expect(triggers.exists()).toBe(true)
    const aiBadge = triggers.find('[title="commands.badgeAi"]')
    expect(aiBadge.exists()).toBe(true)
    expect(aiBadge.findComponent(AppIcon).props('icon')).toBe(
      'mdi:robot-outline'
    )
  })

  it('displays all trigger badges when all are active', () => {
    const wrapper = mountCard({
      isVoiceEnabled: true,
      isAvailableExternally: true,
      description: 'Performs automated diagnostics',
    })
    const triggers = wrapper.find('.command-triggers')
    expect(triggers.exists()).toBe(true)
    expect(triggers.find('[title="commands.badgeVoice"]').exists()).toBe(true)
    expect(triggers.find('[title="commands.badgeExternal"]').exists()).toBe(
      true
    )
    expect(triggers.find('[title="commands.badgeAi"]').exists()).toBe(true)
  })

  it('passes the command type as the header icon tooltip', () => {
    const wrapper = mountCard({ operationId: 'script' })
    const disclosureIcon = wrapper.find('.disclosure-icon')
    expect(disclosureIcon.exists()).toBe(true)
    expect(disclosureIcon.attributes('title')).toBe('Script')
  })
})
