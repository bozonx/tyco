import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import CommandEditor from './CommandEditor.vue'
import type { CommandConfig } from '@tyco/shared'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

const script = (
  toolConfig: Record<string, unknown> = {},
  extra: Partial<CommandConfig> = {}
): CommandConfig => ({
  ...createCommand('script', 'sc1'),
  ...extra,
  toolConfig: { command: '', workingDir: '', takesText: true, ...toolConfig },
})

const mountEditor = (
  command: CommandConfig,
  props: Record<string, unknown> = {}
) =>
  mount(CommandEditor, {
    props: { command, ...props },
    global: { stubs: { CustomActionFields: true, CommandTestRun: true } },
  })

const lastUpdate = (wrapper: ReturnType<typeof mountEditor>) =>
  wrapper.emitted('update')!.at(-1)![0] as CommandConfig

describe('CommandEditor.vue', () => {
  it('requires a name and takes one from the script when left empty', async () => {
    const wrapper = mountEditor(script({ command: "'/opt/my tools/test.sh'" }))
    expect(wrapper.text()).toContain('commands.errorNoName')
    await wrapper.find('.command-tool-fields').trigger('focusout')
    expect(lastUpdate(wrapper).name).toBe('test.sh')
  })

  it('keeps a name the user gave', async () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'List' }))
    expect(wrapper.text()).not.toContain('commands.errorNoName')
    await wrapper.find('.command-tool-fields').trigger('focusout')
    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('shows the result menu instead of a replacement once the text is off', async () => {
    const wrapper = mountEditor(
      script(
        { command: 'ls' },
        {
          name: 'ls',
          launcherAfterRun: {
            withSelection: 'replaceSelection',
            withoutSelection: 'copy',
          },
        }
      )
    )
    wrapper
      .findComponent({ name: 'CustomActionFields' })
      .vm.$emit('update', 'takesText', false)
    const command = lastUpdate(wrapper)
    expect(command.toolConfig.takesText).toBe(false)
    expect(command.launcherAfterRun).toEqual({
      withSelection: 'showMenu',
      withoutSelection: 'copy',
    })
  })

  it('offers no replacement for a command without text', () => {
    const withText = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    expect(withText.text()).toContain('commands.afterRunReplaceSelection')
    const noText = mountEditor(
      script({ command: 'ls', takesText: false }, { name: 'ls' })
    )
    expect(noText.text()).not.toContain('commands.afterRunReplaceSelection')
  })

  it('edits each quick-command context independently and shows fixed behavior elsewhere', async () => {
    const command = script(
      { command: 'echo' },
      {
        name: 'Echo',
        launcherAfterRun: {
          withSelection: 'replaceSelection',
          withoutSelection: 'showMenu',
        },
      }
    )
    const wrapper = mountEditor(command)
    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(2)
    expect(selects[0].find('option[value="replaceSelection"]').exists()).toBe(
      true
    )
    expect(selects[1].find('option[value="replaceSelection"]').exists()).toBe(
      false
    )
    expect(wrapper.text()).toContain('commands.resultMenuBehavior')
    expect(wrapper.text()).toContain('commands.resultExternalBehavior')
    await selects[0].setValue('copy')
    expect(lastUpdate(wrapper).launcherAfterRun).toEqual({
      withSelection: 'copy',
      withoutSelection: 'showMenu',
    })
    await wrapper.setProps({ command: lastUpdate(wrapper) })
    await selects[1].setValue('none')
    expect(lastUpdate(wrapper).launcherAfterRun).toEqual({
      withSelection: 'copy',
      withoutSelection: 'none',
    })
  })

  it('shows the call from outside only for a command allowed there', () => {
    const command = script({ command: 'ls' }, { name: 'Work note' })
    expect(mountEditor(command).find('.command-cli').exists()).toBe(false)
    const external = {
      ...command,
      availableIn: { external: true, chat: false },
    }
    expect(mountEditor(external).find('.command-cli').text()).toBe(
      "tyco-ctl run 'Work note' --name"
    )
    // a name another command shares would be refused: the id is used
    expect(
      mountEditor(external, { nameTwins: [script()] })
        .find('.command-cli')
        .text()
    ).toBe('tyco-ctl run sc1')
  })

  it('shows where the command is placed and leads to those settings', async () => {
    const wrapper = mountEditor(
      script({ command: 'ls', takesText: false }, { name: 'ls' }),
      { menuSlot: 1 }
    )
    const places = wrapper
      .findAll('.command-place')
      .filter((place) => place.find('button').exists())
    expect(places[0].text()).toContain('W')
    expect(places[0].text()).toContain('commands.placeMenuEditorOnly')
    expect(places[1].text()).toContain('commands.placeLauncherSearch')
    await places[1].find('button').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([['launcher-commands']])
  })

  it('stores a whole timeout and drops an empty one', async () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    const input = wrapper.find('input[type="number"]')
    await input.setValue('90')
    expect(lastUpdate(wrapper).toolConfig.timeoutSec).toBe(90)
    await input.setValue('')
    expect(lastUpdate(wrapper).toolConfig).not.toHaveProperty('timeoutSec')
  })
})
