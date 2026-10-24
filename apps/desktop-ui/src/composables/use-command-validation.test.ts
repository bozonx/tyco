import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../lib/commands/command-config'
import { useCommandValidation } from './use-command-validation'

vi.mock('../stores/tools', () => ({
  useToolsStore: () => ({ get: () => undefined }),
}))
vi.mock('./use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => `translated:${key}` }),
}))

describe('command validation', () => {
  it('returns translated issues only for the requested field and reacts to command changes', () => {
    const state = reactive({ command: createCommand('script', 'script') })
    const warningsOf = useCommandValidation(() => state.command)
    expect(warningsOf('command')).toEqual([
      'translated:commands.errorNoCommand',
    ])
    expect(warningsOf('url')).toEqual([])
    state.command.toolConfig.command = 'echo {text}'
    expect(warningsOf('command')).toEqual([])
    state.command = createCommand('webhook', 'webhook')
    expect(warningsOf('url')).toEqual(['translated:commands.errorNoUrl'])
    expect(warningsOf('command')).toEqual([])
  })
})
