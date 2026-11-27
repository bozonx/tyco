import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { CommandConfig } from '@tyco/shared'

import Button from '../common/Button.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
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
  operationId: 'script',
  operationConfig: {},
  isLlmArgumentParsingEnabled: false,
  outputAction: 'none',
  isOutputLogged: false,
  isAvailableExternally: false,
  isEnabled: true,
}

const commandWithoutDesc: CommandConfig = {
  id: 'cmd-2',
  name: 'No Description',
  description: '   ',
  phrases: [],
  isVoiceEnabled: false,
  operationId: 'script',
  operationConfig: {},
  isLlmArgumentParsingEnabled: false,
  outputAction: 'none',
  isOutputLogged: false,
  isAvailableExternally: false,
  isEnabled: true,
}

const commandTwo: CommandConfig = {
  ...commandWithDesc,
  id: 'cmd-3',
  name: 'Lint',
  description: 'Lints the project',
}

const mountTools = (
  pickedCommandIds?: string[],
  commands: CommandConfig[] = [commandWithDesc, commandTwo]
) =>
  mount(SettingsProfileCommandTools, {
    props: {
      commands,
      tools: { sources: {}, tools: {}, pickedCommandIds },
      catalog: undefined,
    },
  })

const lastUpdate = (wrapper: ReturnType<typeof mountTools>) =>
  wrapper.emitted('update')?.at(-1)?.[0]

describe('SettingsProfileCommandTools', () => {
  it('renders empty state when no commands configured', () => {
    const wrapper = mountTools(undefined, [])
    expect(wrapper.text()).toContain('chatTools.commands.noCommands')
  })

  it('offers every command by default, without checkboxes', () => {
    const wrapper = mountTools()
    expect(wrapper.text()).toContain('Format Code')
    expect(wrapper.text()).toContain('chatTools.commands.pickAllHint')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
    const [policy, mode] = wrapper.findAllComponents(SegmentedControl)
    // running a command asks by default
    expect(policy!.props('modelValue')).toBe('ask')
    expect(mode!.props('modelValue')).toBe('all')
  })

  it('sets the policy of every command at once', () => {
    const wrapper = mountTools()
    wrapper
      .findAllComponents(SegmentedControl)[0]!
      .vm.$emit('update:modelValue', 'allow')
    expect(lastUpdate(wrapper)).toEqual({
      sources: {},
      tools: {
        'commands:commands:cmd-1': 'allow',
        'commands:commands:cmd-3': 'allow',
      },
    })
    wrapper
      .findAllComponents(SegmentedControl)[0]!
      .vm.$emit('update:modelValue', 'off')
    expect(lastUpdate(wrapper)?.sources).toEqual({
      'commands:commands': { isEnabled: false },
    })
  })

  it('starts picking from every command and back to all', () => {
    const wrapper = mountTools()
    wrapper
      .findAllComponents(SegmentedControl)[1]!
      .vm.$emit('update:modelValue', 'some')
    expect(lastUpdate(wrapper)?.pickedCommandIds).toEqual(['cmd-1', 'cmd-3'])

    const picking = mountTools(['cmd-1'])
    picking
      .findAllComponents(SegmentedControl)[1]!
      .vm.$emit('update:modelValue', 'all')
    expect('pickedCommandIds' in lastUpdate(picking)!).toBe(false)
  })

  it('picks commands one by one and hides unsupported ones behind a toggle', async () => {
    const wrapper = mountTools(['cmd-1'], [commandWithDesc, commandWithoutDesc])
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(1)
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(true)
    await checkboxes[0]!.setValue(false)
    expect(lastUpdate(wrapper)?.pickedCommandIds).toEqual([])

    expect(wrapper.text()).not.toContain('chatTools.commands.needsDescription')
    await wrapper.find('.profile-command-unsupported-btn').trigger('click')
    expect(wrapper.text()).toContain('No Description')
    expect(wrapper.text()).toContain('chatTools.commands.needsDescription')
  })

  it('selects and deselects all, dropping removed commands', async () => {
    const wrapper = mountTools(['gone'])
    const buttons = wrapper.findAllComponents(Button)
    const selectAll = buttons.find((b) =>
      b.text().includes('chatTools.commands.selectAll')
    )!
    await selectAll.trigger('click')
    expect(lastUpdate(wrapper)?.pickedCommandIds).toEqual(['cmd-1', 'cmd-3'])

    const all = mountTools(['cmd-1', 'cmd-3'])
    const deselectAll = all
      .findAllComponents(Button)
      .find((b) => b.text().includes('chatTools.commands.deselectAll'))!
    await deselectAll.trigger('click')
    expect(lastUpdate(all)?.pickedCommandIds).toEqual([])
  })
})
