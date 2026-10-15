import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import type { RegisteredTool } from '../../lib/tools/tool-types'
import ToolConfigFields from './ToolConfigFields.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../stores/tools', () => ({
  useToolsStore: () => ({ get: () => undefined }),
}))

const tool: RegisteredTool = {
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

describe('ToolConfigFields', () => {
  it('preserves explicit false and clears a boolean override when inheritance is selected', async () => {
    const wrapper = mount(ToolConfigFields, {
      props: {
        tool,
        command: {
          ...createCommand(tool.id, 'example'),
          toolConfig: { enabled: false },
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
    const wrapper = mount(ToolConfigFields, {
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
})
