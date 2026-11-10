import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { CommandConfig } from '@tyco/shared'

import SettingsProfileCommandTools from './SettingsProfileCommandTools.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const commandWithDesc: CommandConfig = {
  id: 'cmd-1',
  name: 'Format Code',
  description: 'Formats selected code',
  phrases: [],
  isVoiceEnabled: false,
  toolId: 'script',
  toolConfig: {},
  isLlmArgumentParsingEnabled: false,
  outputAction: 'none',
  isOutputLogged: false,
  isAvailableExternally: false,
  externalTimeoutSec: 120,
  isEnabled: true,
}

const commandWithoutDesc: CommandConfig = {
  id: 'cmd-2',
  name: 'No Description',
  description: '   ',
  phrases: [],
  isVoiceEnabled: false,
  toolId: 'script',
  toolConfig: {},
  isLlmArgumentParsingEnabled: false,
  outputAction: 'none',
  isOutputLogged: false,
  isAvailableExternally: false,
  externalTimeoutSec: 120,
  isEnabled: true,
}

describe('SettingsProfileCommandTools', () => {
  it('renders empty state when no commands configured', () => {
    const wrapper = mount(SettingsProfileCommandTools, {
      props: { commands: [], selectedIds: [] },
    })

    expect(wrapper.text()).toContain('chatTools.commands.noCommands')
  })

  it('renders commands with checkboxes and description or warning', async () => {
    const wrapper = mount(SettingsProfileCommandTools, {
      props: {
        commands: [commandWithDesc, commandWithoutDesc],
        selectedIds: ['cmd-1'],
      },
    })

    expect(wrapper.text()).toContain('Format Code')
    expect(wrapper.text()).toContain('Formats selected code')
    expect(wrapper.text()).toContain('No Description')
    expect(wrapper.text()).toContain('chatTools.commands.needsDescription')

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)

    // cmd-1 is selected and enabled
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[0]!.element as HTMLInputElement).disabled).toBe(false)

    // cmd-2 has no description, so it is disabled
    expect((checkboxes[1]!.element as HTMLInputElement).disabled).toBe(true)

    // Toggling cmd-1 emits toggle event
    await checkboxes[0]!.setValue(false)
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['cmd-1', false])
  })

  it('selects and deselects all selectable commands', async () => {
    const cmd3: CommandConfig = {
      ...commandWithDesc,
      id: 'cmd-3',
      name: 'Lint Code',
    }
    const wrapper = mount(SettingsProfileCommandTools, {
      props: {
        commands: [commandWithDesc, commandWithoutDesc, cmd3],
        selectedIds: ['cmd-1'],
      },
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    expect(buttons.length).toBe(2)

    // Select all
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('updateSelected')?.[0]).toEqual([['cmd-1', 'cmd-3']])

    // Deselect all
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('updateSelected')?.[1]).toEqual([[]])
  })

  it('displays platform badge and notice when command is for another platform', () => {
    const windowsCmd: CommandConfig = {
      ...commandWithDesc,
      id: 'cmd-win',
      name: 'Windows Script',
      platforms: ['windows'],
    }
    const wrapper = mount(SettingsProfileCommandTools, {
      props: {
        commands: [windowsCmd],
        selectedIds: [],
        currentPlatform: 'linux',
      },
    })

    expect(wrapper.text()).toContain('Windows')
    expect(wrapper.text()).toContain('commands.otherPlatform')
  })
})
