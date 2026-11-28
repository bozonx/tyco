import { flushPromises, mount } from '@vue/test-utils'
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
vi.mock('../../stores/operations', async () => {
  const { testOperations } = await import('../../lib/operations/testing')
  const tools = testOperations()
  return { useOperationsStore: () => tools }
})

const script = (
  operationConfig: Record<string, unknown> = {},
  extra: Partial<CommandConfig> = {}
): CommandConfig => ({
  ...createCommand('script', 'sc1'),
  ...extra,
  operationConfig: { command: '', workingDirectory: '', ...operationConfig },
})

const mountEditor = (
  command: CommandConfig,
  props: Record<string, unknown> = {}
) =>
  mount(CommandEditor, {
    props: { command, ...props },
    global: {
      stubs: { CustomActionFields: true, CommandTestRun: true, Teleport: true },
    },
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

  it('has one output action, with or without a selection', async () => {
    const command = script(
      { command: 'echo {{TEXT}}' },
      { name: 'Echo', outputAction: 'insertIntoWindow' }
    )
    const wrapper = mountEditor(command)
    const selects = wrapper.findAll('[role="combobox"]')
    expect(selects).toHaveLength(1)
    expect(selects[0].text()).toBe('commands.afterRunInsert')
    await selects[0].trigger('click')
    await wrapper
      .findAll('[role="option"]')
      .find((option) => option.text() === 'commands.afterRunCopy')!
      .trigger('click')
    expect(lastUpdate(wrapper).outputAction).toBe('copyToClipboard')
  })

  it('offers the insertion for a command without text too', async () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    await wrapper.get('[role="combobox"]').trigger('click')
    expect(wrapper.text()).toContain('commands.afterRunInsert')
  })

  it('disables the output action and forces none for detached scripts', () => {
    const command = script(
      { command: 'firefox', isDetached: true },
      { name: 'Firefox', outputAction: 'insertIntoWindow' }
    )
    const wrapper = mountEditor(command)
    const select = wrapper.find('[role="combobox"]')
    expect(select.attributes('disabled')).toBeDefined()
    expect(select.text()).toBe('settings.actionAfterRunNone')
    expect(wrapper.text()).toContain('commands.detachedOutputActionHint')
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
    const wrapper = mountEditor(
      script({ command: 'ls' }, { name: 'ls', platforms: ['linux'] })
    )
    const advanced = wrapper.get('.command-group-advanced')
    expect(advanced.get('[aria-expanded]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(advanced.find('section').text()).toContain(
      'commands.launcherResultGroup'
    )
    expect(advanced.findAll('.command-place')).toHaveLength(0)
    // the external toggle, voice toggle, pre-transform, and platforms
    expect(advanced.findAll('input[type="checkbox"]')).toHaveLength(6)
    expect(
      advanced.find('[data-testid="command-platform-linux"]').exists()
    ).toBe(true)
    expect(wrapper.findAll('.command-place')).toHaveLength(0)
  })

  it('shows platform selection only for tools with canSelectPlatforms and does not link the group label', async () => {
    const scriptEditor = mountEditor(script({ command: 'ls' }, { name: 'ls' }))
    const linuxCheckbox = scriptEditor.get(
      'input[data-testid="command-platform-linux"]'
    )
    const platformsLabel = scriptEditor
      .findAll('.field-row-title span')
      .find((el) => el.text() === 'commands.platforms')
    expect(platformsLabel).toBeDefined()
    await platformsLabel!.trigger('click')
    expect((linuxCheckbox.element as HTMLInputElement).checked).toBe(false)
    expect(scriptEditor.emitted('update')).toBeUndefined()

    const webhookEditor = mountEditor({
      ...createCommand('webhook', 'wh1'),
      name: 'Hook',
      operationConfig: { url: 'https://x.test' },
    })
    expect(
      webhookEditor.find('[data-testid="command-platform-linux"]').exists()
    ).toBe(false)
    expect(webhookEditor.find('.command-open-log').exists()).toBe(true)

    const unknownOperationEditor = mountEditor({
      ...createCommand('other.plugin', 'p1'),
      name: 'Other',
    })
    expect(
      unknownOperationEditor
        .find('[data-testid="command-platform-linux"]')
        .exists()
    ).toBe(false)
    expect(unknownOperationEditor.find('.command-open-log').exists()).toBe(
      false
    )
  })

  it('places description inside advanced, keeps advanced closed, and shows badge indicator', async () => {
    const wrapper = mountEditor(
      script({ command: 'ls' }, { name: 'List', description: 'Lists files' })
    )
    const advanced = wrapper.get('.command-group-advanced')
    // description does not open advanced and lives inside it
    expect(advanced.get('[aria-expanded]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(advanced.find('.command-description').exists()).toBe(true)
    expect(wrapper.find('[data-testid="command-advanced-badge"]').text()).toBe(
      '1'
    )
    expect(advanced.find('.command-llm-pre-transform-prompt').exists()).toBe(
      false
    )

    // Toggle on
    const preTransformSwitch = advanced.get(
      'input[type="checkbox"][aria-label="commands.llmPreTransform"]'
    )
    await preTransformSwitch.setValue(true)

    expect(lastUpdate(wrapper).isLlmPreTransformEnabled).toBe(true)

    // With pre-transformation enabled, no inline warning is shown on the prompt label
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
    expect(advanced.text()).not.toContain('commands.errorNoPrompt')

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
    const voiceFields = wrapper.findComponent({ name: 'CommandVoiceFields' })
    expect(voiceFields.find('textarea').exists()).toBe(false)
    await voiceFields.find('input[role="switch"]').setValue(true)
    const command = lastUpdate(wrapper)
    expect(command.isVoiceEnabled).toBe(true)
    await wrapper.setProps({ command })
    const phrases = voiceFields.get('textarea')
    await phrases.setValue('save note\nmake note')
    expect(lastUpdate(wrapper).phrases).toEqual(['save note', 'make note'])
    expect(voiceFields.findComponent(InfoTooltip).props('text')).toBe(
      'voiceCommands.phrasesInfo'
    )
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1)
    expect(voiceFields.findAll('.command-hint')).toHaveLength(0)
  })

  it('does not auto-expand advanced, but shows badge indicator for customizations', async () => {
    const wrapper = mountEditor(script({ command: 'ls' }, { name: 'List' }))
    const advanced = wrapper.get('.command-group-advanced')
    expect(advanced.get('[aria-expanded]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(
      wrapper.find('[data-testid="command-advanced-badge"]').exists()
    ).toBe(false)

    await wrapper.setProps({
      command: {
        ...script({ command: 'ls' }, { name: 'List' }),
        description: 'Tool description',
        isVoiceEnabled: true,
      },
    })
    expect(advanced.get('[aria-expanded]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(wrapper.find('[data-testid="command-advanced-badge"]').text()).toBe(
      '2'
    )
  })

  it('shows test section for AI commands and hides pre-transformation', () => {
    const aiCommand: CommandConfig = {
      ...createCommand('core.aiTask', 'ai1'),
      name: 'AI Task',
      operationConfig: { prompt: 'Do something' },
    }
    const wrapper = mountEditor(aiCommand)
    expect(wrapper.findComponent({ name: 'CommandTestRun' }).exists()).toBe(
      true
    )

    const advanced = wrapper.get('.command-group-advanced')
    expect(
      advanced
        .find('input[type="checkbox"][aria-label="commands.llmPreTransform"]')
        .exists()
    ).toBe(false)
  })
})
