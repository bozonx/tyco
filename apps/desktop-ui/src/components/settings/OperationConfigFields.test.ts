import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import type { RegisteredOperation } from '../../lib/operations/operation-types'
import { installFakeDesktop } from '../../test/install-fake-desktop'
import DirectoryPickerButton from './DirectoryPickerButton.vue'
import OperationConfigFields from './OperationConfigFields.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../stores/operations', () => ({
  useOperationsStore: () => ({ get: () => undefined }),
}))

const tool: RegisteredOperation = {
  id: 'example.transform',
  description: 'Transform text',
  owner: { kind: 'plugin', pluginId: 'example' },
  inputSchema: { type: 'object' },
  run: async () => ({ ok: true, content: '' }),
  baseConfig: () => ({ enabled: true, prompt: 'Shared prompt' }),
  configFields: [
    { type: 'checkbox', name: 'enabled', label: 'Enabled' },
    { type: 'textarea', name: 'prompt', label: 'Prompt' },
  ],
}

describe('OperationConfigFields', () => {
  it('shows the step limit of an AI command, empty for the one of the LLM settings', async () => {
    const wrapper = mount(OperationConfigFields, {
      props: {
        tool: { ...tool, id: 'core.aiTask' },
        command: createCommand('core.aiTask', 'agent'),
        userConfig: { llm: { maxToolSteps: 12 } } as never,
      },
    })
    const input = wrapper.get('input[type="number"]')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(input.attributes('placeholder')).toBe('12')
    await input.setValue('3')
    expect(wrapper.emitted('update')?.at(-1)).toEqual(['maxSteps', 3])
    await input.setValue('')
    expect(wrapper.emitted('update')?.at(-1)).toEqual(['maxSteps', undefined])
  })

  it('preserves explicit false and clears a boolean override when inheritance is selected', async () => {
    const wrapper = mount(OperationConfigFields, {
      props: {
        tool,
        command: {
          ...createCommand(tool.id, 'example'),
          operationConfig: { enabled: false },
        },
      },
    })
    const select = wrapper.get('select')
    expect((select.element as HTMLSelectElement).selectedIndex).toBe(2)
    await select.setValue('1')
    expect(wrapper.emitted('update')?.at(-1)).toEqual(['enabled', true])
    await select.setValue('0')
    expect(wrapper.emitted('update')?.at(-1)).toEqual(['enabled', undefined])
    await select.setValue('2')
    expect(wrapper.emitted('update')?.at(-1)).toEqual(['enabled', false])
  })

  it('keeps inherited text as a hint and links each control to its own visible label', async () => {
    const wrapper = mount(OperationConfigFields, {
      props: { tool, command: createCommand(tool.id, 'example') },
    })
    await wrapper.vm.$nextTick()
    const textarea = wrapper.get('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
    expect(textarea.attributes('placeholder')).toBe(
      'commands.fromPluginSettings'
    )
    const label = wrapper
      .findAll('label[id]')
      .find((item) => item.text() === 'Prompt')!
    expect(textarea.attributes('aria-labelledby')).toBe(label.attributes('id'))
    expect(label.attributes('for')).toBe(textarea.attributes('id'))
    await textarea.setValue('Command prompt')
    expect(wrapper.emitted('update')?.at(-1)).toEqual([
      'prompt',
      'Command prompt',
    ])
  })

  it('shows fields, inherited values and the preview for what a run gets', async () => {
    const desktop = installFakeDesktop()
    const previewConfig = vi.fn(async (config: Record<string, unknown>) => ({
      samples: [`${String(config.folder)}:${String(config.template)}`],
    }))
    const withModes: RegisteredOperation = {
      ...tool,
      baseConfig: () => ({ mode: 'a', template: 'base', folder: '/notes' }),
      configPresets: { mode: { b: { template: 'preset' } } },
      directoryFieldName: 'folder',
      previewConfig,
      configFields: [
        { type: 'text', name: 'folder', label: 'Folder' },
        {
          type: 'select',
          name: 'mode',
          label: 'Mode',
          defaultValue: 'a',
          options: [{ id: 'a' }, { id: 'b' }],
        },
        {
          type: 'text',
          name: 'template',
          label: 'Template',
          visibleWhen: { field: 'mode', equals: ['b'] },
        },
      ],
    }
    const command = createCommand(withModes.id, 'example')
    const wrapper = mount(OperationConfigFields, {
      props: { tool: withModes, command },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Template')
    expect(wrapper.findAllComponents(DirectoryPickerButton)).toHaveLength(1)
    expect(wrapper.get('pre').text()).toBe('/notes:base')

    await wrapper.setProps({
      command: { ...command, operationConfig: { mode: 'b' } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Template')
    // the empty field falls back to the preset the command selects
    expect(previewConfig).toHaveBeenLastCalledWith({
      mode: 'b',
      template: 'preset',
      folder: '/notes',
    })
    expect(wrapper.get('pre').text()).toBe('/notes:preset')
    desktop.dispose()
  })
})
