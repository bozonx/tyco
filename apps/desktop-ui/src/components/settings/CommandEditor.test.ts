import { type DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import InfoTooltip from '../common/InfoTooltip.vue'
import CommandEditor from './CommandEditor.vue'
import type { CommandConfig } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
const { callFunction, toast } = vi.hoisted(() => ({
  callFunction: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('../../stores/ipc', () => ({ useIpcStore: () => ({ callFunction }) }))
vi.mock('../../composables/use-toast', () => ({ default: () => ({ toast }) }))
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
  toolConfig: { command: '', workingDir: '', ...toolConfig },
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
    toast.mockReset()
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

  it('offers no replacement for a command without text', () => {
    const withText = mountEditor(
      script({ command: 'wc {{TEXT}}' }, { name: 'wc' })
    )
    expect(withText.text()).toContain('commands.afterRunReplaceSelection')
    const noText = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    expect(noText.text()).not.toContain('commands.afterRunReplaceSelection')
  })

  const optionValue = (select: DOMWrapper<Element>, text: string) =>
    select
      .findAll('option')
      .find((option) => option.text() === text)!
      .attributes('value')

  it('asks what to do without a selection only for a replacement', async () => {
    const command = script(
      { command: 'echo {{TEXT}}' },
      {
        name: 'Echo',
        launcherAfterRun: { action: 'replaceSelection', fallback: 'showMenu' },
      }
    )
    const wrapper = mountEditor(command)
    let selects = wrapper.findAll('select')
    expect(selects).toHaveLength(2)
    expect(wrapper.text()).toContain('commands.launcherFallback')
    expect(
      selects[1]
        .findAll('option')
        .some((option) => option.text() === 'commands.afterRunReplaceSelection')
    ).toBe(false)
    await selects[1].setValue(
      optionValue(selects[1], 'settings.actionAfterRunNone')
    )
    expect(lastUpdate(wrapper).launcherAfterRun).toEqual({
      action: 'replaceSelection',
      fallback: 'none',
    })
    await wrapper.setProps({ command: lastUpdate(wrapper) })
    await selects[0].setValue(optionValue(selects[0], 'commands.afterRunCopy'))
    expect(lastUpdate(wrapper).launcherAfterRun).toEqual({
      action: 'copy',
      fallback: 'none',
    })
    await wrapper.setProps({ command: lastUpdate(wrapper) })
    selects = wrapper.findAll('select')
    expect(selects).toHaveLength(1)
    expect(wrapper.text()).not.toContain('commands.launcherFallback')
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
      mountEditor(external, { nameTwins: [script()] })
        .find('.command-cli')
        .text()
    ).toBe('tyco-ctl run sc1')
  })

  it('shows the fallback of a replacement for a command without text', () => {
    const wrapper = mountEditor(
      script(
        { command: 'ls' },
        {
          name: 'ls',
          launcherAfterRun: { action: 'replaceSelection', fallback: 'copy' },
        }
      )
    )
    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(1)
    expect((selects[0].element as HTMLSelectElement).value).toBe(
      optionValue(selects[0], 'commands.afterRunCopy')
    )
    expect(wrapper.text()).not.toContain('commands.launcherFallback')
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

  it('explains selection-specific result behavior for text commands', () => {
    const withText = mountEditor(script({ command: 'echo {{TEXT}}' }))
    const section = withText.findAll('details').at(-1)!.find('section')
    const tooltip = section.findComponent(InfoTooltip)
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.props('text')).toBe('commands.launcherSelectionHint')

    const noText = mountEditor(script({ command: 'echo hello' }))
    const noTextSection = noText.findAll('details').at(-1)!.find('section')
    expect(noTextSection.findComponent(InfoTooltip).exists()).toBe(false)
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
    expect(toast).not.toHaveBeenCalled()

    callFunction.mockResolvedValueOnce({ success: true, result: false })
    await button.trigger('click')
    await flushPromises()
    expect(toast).toHaveBeenCalledWith('commands.logEmpty')
  })
})
