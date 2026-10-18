import { type DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import InfoTooltip from '../common/InfoTooltip.vue'
import CommandEditor from './CommandEditor.vue'
import type { CommandConfig } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
const { callFunction, toastKey } = vi.hoisted(() => ({
  callFunction: vi.fn(),
  toastKey: vi.fn(),
}))
vi.mock('../../stores/ipc', () => ({ useIpcStore: () => ({ callFunction }) }))
vi.mock('../../stores/desktop', () => ({ useDesktopStore: () => ({}) }))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey }),
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
  toolConfig: { command: '', workingDirectory: '', ...toolConfig },
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
  beforeEach(() => {
    callFunction.mockReset()
    toastKey.mockReset()
  })

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

  it('forwards autofocusName to the name input', () => {
    const wrapper = mountEditor(script(), { autofocusName: true })
    const nameInput = wrapper.findComponent({ name: 'FieldInput' })
    expect(nameInput.props('autofocus')).toBe(true)
  })

  const optionValue = (select: DOMWrapper<Element>, text: string) =>
    select
      .findAll('option')
      .find((option) => option.text() === text)!
      .attributes('value')

  it('has one output action, with or without a selection', async () => {
    const command = script(
      { command: 'echo {{TEXT}}' },
      { name: 'Echo', launcherAfterRun: { action: 'insertIntoWindow' } }
    )
    const wrapper = mountEditor(command)
    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(1)
    expect((selects[0].element as HTMLSelectElement).value).toBe(
      optionValue(selects[0], 'commands.afterRunInsert')
    )
    await selects[0].setValue(optionValue(selects[0], 'commands.afterRunCopy'))
    expect(lastUpdate(wrapper).launcherAfterRun).toEqual({ action: 'copy' })
  })

  it('offers the insertion for a command without text too', () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    expect(wrapper.text()).toContain('commands.afterRunInsert')
  })

  it('shows the call from outside only for a command allowed there', () => {
    const command = script({ command: 'ls' }, { name: 'Work note' })
    expect(mountEditor(command).find('.command-cli').exists()).toBe(false)
    const external = {
      ...command,
      availableIn: { external: true, chat: false },
    }
    expect(mountEditor(external).find('.command-cli').text()).toBe(
      "tyco-ctl run --name 'Work note'"
    )
    // a name another command shares would be refused: the id is used
    expect(
      mountEditor(external, { nameConflicts: [script()] })
        .find('.command-cli')
        .text()
    ).toBe('tyco-ctl run sc1')
  })

  it('keeps placement settings inside advanced and uses one external toggle', () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    const advanced = wrapper.findAll('details').at(-1)!
    expect(advanced.element.open).toBe(false)
    expect(advanced.find('section').text()).toContain(
      'commands.launcherResultGroup'
    )
    expect(advanced.findAll('.command-place')).toHaveLength(0)
    expect(advanced.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(wrapper.findAll('.command-place')).toHaveLength(0)
  })

  it('explains how the insertion treats a selection', () => {
    const wrapper = mountEditor(script({ command: 'echo hello' }))
    const section = wrapper.findAll('details').at(-1)!.find('section')
    const tooltip = section.findComponent(InfoTooltip)
    expect(tooltip.props('text')).toBe('commands.launcherSelectionHint')
  })

  it('stores a whole timeout and drops an empty one', async () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    const input = wrapper.find('input[type="number"]')
    await input.setValue('90')
    expect(lastUpdate(wrapper).toolConfig.timeoutSec).toBe(90)
    await input.setValue('')
    expect(lastUpdate(wrapper).toolConfig).not.toHaveProperty('timeoutSec')
  })

  it('opens the log and tells when there is none yet', async () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    const button = wrapper.find('.command-open-log')
    callFunction.mockResolvedValueOnce({ success: true, result: true })
    await button.trigger('click')
    expect(callFunction).toHaveBeenCalledWith('openActionLog', [])
    expect(toastKey).not.toHaveBeenCalled()

    callFunction.mockResolvedValueOnce({ success: true, result: false })
    await button.trigger('click')
    await flushPromises()
    expect(toastKey).toHaveBeenCalledWith('commands.logEmpty')
  })
  it('distinguishes incomplete and unknown phrases and names ambiguous candidates', async () => {
    const command = script(
      { command: 'echo {{TEXT}}' },
      { name: 'Work note', isVoiceEnabled: true, phrases: ['save note'] }
    )
    const other = { ...command, id: 'other', name: 'Personal note' }
    const wrapper = mountEditor(command, {
      userConfig: { commands: [command, other] },
    })
    const trial = wrapper
      .findAll('input')
      .find((input) =>
        input.element
          .closest('.field-row')
          ?.textContent?.includes('voiceCommands.try')
      )!
    await trial.setValue('save')
    expect(wrapper.text()).toContain('voiceCommands.incomplete')
    await trial.setValue('unrelated')
    expect(wrapper.text()).toContain('voiceCommands.none')
    await trial.setValue('save note Hello!')
    expect(wrapper.text()).toContain('voiceCommands.choose')
    expect(wrapper.text()).toContain('Work note: Hello!')
    expect(wrapper.text()).toContain('Personal note: Hello!')
  })
})
