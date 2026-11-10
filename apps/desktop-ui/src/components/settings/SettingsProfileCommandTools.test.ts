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

  it('renders supported commands with checkboxes and hides unsupported behind toggle', async () => {
    const wrapper = mount(SettingsProfileCommandTools, {
      props: {
        commands: [commandWithDesc, commandWithoutDesc],
        selectedIds: ['cmd-1'],
      },
    })

    expect(wrapper.text()).toContain('Format Code')
    expect(wrapper.text()).toContain('Formats selected code')
    // Unsupported toggle is shown
    expect(wrapper.text()).toContain('chatTools.commands.unsupportedCommands')

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(1)
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(true)

    // Toggling cmd-1 emits toggle event
    await checkboxes[0]!.setValue(false)
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['cmd-1', false])

    // Expanding unsupported commands section reveals cmd-2
    expect(wrapper.text()).not.toContain('chatTools.commands.needsDescription')
    const toggleBtn = wrapper.find('.profile-command-unsupported-btn')
    await toggleBtn.trigger('click')

    expect(wrapper.text()).toContain('No Description')
    expect(wrapper.text()).toContain('chatTools.commands.needsDescription')
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

    const actionButtons = wrapper.findAll(
      '.profile-command-tools-actions button'
    )
    expect(actionButtons.length).toBe(2)

    // Select all
    await actionButtons[0]!.trigger('click')
    expect(wrapper.emitted('updateSelected')?.[0]).toEqual([['cmd-1', 'cmd-3']])

    // Deselect all
    await actionButtons[1]!.trigger('click')
    expect(wrapper.emitted('updateSelected')?.[1]).toEqual([[]])
  })

  it('places command for another platform into unsupported section with badge and notice', async () => {
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

    expect(wrapper.text()).toContain('chatTools.commands.unsupportedCommands')
    const toggleBtn = wrapper.find('.profile-command-unsupported-btn')
    await toggleBtn.trigger('click')

    expect(wrapper.text()).toContain('Windows')
    expect(wrapper.text()).toContain('commands.otherPlatform')
  })
})
