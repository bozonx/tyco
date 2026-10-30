import { type DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import InfoTooltip from '../common/InfoTooltip.vue'
import CommandEditor from './CommandEditor.vue'
import type { CommandConfig } from '@tyco/shared'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
const { toastKey } = vi.hoisted(() => ({ toastKey: vi.fn() }))
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
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop()
  })

  afterEach(() => desktop.dispose())

  beforeEach(() => {
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
      { name: 'Echo', outputAction: 'insertIntoWindow' }
    )
    const wrapper = mountEditor(command)
    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(1)
    expect((selects[0].element as HTMLSelectElement).value).toBe(
      optionValue(selects[0], 'commands.afterRunInsert')
    )
    await selects[0].setValue(optionValue(selects[0], 'commands.afterRunCopy'))
    expect(lastUpdate(wrapper).outputAction).toBe('copyToClipboard')
  })

  it('offers the insertion for a command without text too', () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    expect(wrapper.text()).toContain('commands.afterRunInsert')
  })

  it('shows the call from outside only for a command allowed there', () => {
    const command = script({ command: 'ls' }, { name: 'Work note' })
    expect(mountEditor(command).find('.command-cli').exists()).toBe(false)
    const external = { ...command, isAvailableExternally: true }
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
    const advanced = wrapper.get('.command-group-advanced')
    expect(advanced.get('[aria-expanded]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(advanced.find('section').text()).toContain(
      'commands.launcherResultGroup'
    )
    expect(advanced.findAll('.command-place')).toHaveLength(0)
    expect(advanced.findAll('input[type="checkbox"]')).toHaveLength(3)
    expect(wrapper.findAll('.command-place')).toHaveLength(0)
  })

  it('toggles LLM pre-transformation and shows the prompt textarea', async () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'List' }))
    const advanced = wrapper.get('.command-group-advanced')
    expect(advanced.find('.command-llm-pre-transform-prompt').exists()).toBe(
      false
    )

    // Toggle on
    const preTransformSwitch = advanced.get(
      'input[type="checkbox"][aria-label="commands.llmPreTransform"]'
    )
    await preTransformSwitch.setValue(true)

    expect(lastUpdate(wrapper).isLlmPreTransformEnabled).toBe(true)

    // With pre-transformation enabled
    await wrapper.setProps({
      command: {
        ...script({ command: 'ls' }, { name: 'List' }),
        isLlmPreTransformEnabled: true,
        llmPreTransformPrompt: '',
      },
    })
    expect(advanced.find('.command-llm-pre-transform-prompt').exists()).toBe(
      true
    )
    expect(advanced.text()).toContain('commands.errorNoPrompt')

    const textarea = advanced.get('textarea.command-llm-pre-transform-prompt')
    await textarea.setValue('Translate to French')
    expect(lastUpdate(wrapper).llmPreTransformPrompt).toBe(
      'Translate to French'
    )
  })

  it('explains how the insertion treats a selection', () => {
    const wrapper = mountEditor(script({ command: 'echo hello' }))
    const section = wrapper.get('.command-group-advanced').find('section')
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
    let hasLog = true
    desktop.backend.handle('open_action_log', () => hasLog)
    await button.trigger('click')
    await flushPromises()
    expect(desktop.backend.callsOf('open_action_log')).toHaveLength(1)
    expect(toastKey).not.toHaveBeenCalled()

    hasLog = false
    await button.trigger('click')
    await flushPromises()
    expect(toastKey).toHaveBeenCalledWith('commands.logEmpty')
  })
  it('shows voice phrases immediately after enabling a new command', async () => {
    const wrapper = mountEditor(script())
    expect(
      wrapper
        .findComponent({ name: 'CommandVoiceFields' })
        .find('textarea')
        .exists()
    ).toBe(false)
    await wrapper.find('input[role="switch"]').setValue(true)
    const command = lastUpdate(wrapper)
    expect(command.isVoiceEnabled).toBe(true)
    await wrapper.setProps({ command })
    const phrases = wrapper
      .findComponent({ name: 'CommandVoiceFields' })
      .get('textarea')
    await phrases.setValue('save note\nmake note')
    expect(lastUpdate(wrapper).phrases).toEqual(['save note', 'make note'])
    expect(wrapper.findComponent(InfoTooltip).props('text')).toBe(
      'voiceCommands.phrasesInfo'
    )
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1)
    expect(
      wrapper
        .findComponent({ name: 'CommandVoiceFields' })
        .findAll('.command-hint')
    ).toHaveLength(0)
  })
})
