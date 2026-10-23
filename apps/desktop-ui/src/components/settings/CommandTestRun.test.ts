import { flushPromises, mount } from '@vue/test-utils'
import type { CommandConfig } from '@tyco/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import {
  type CommandTestResult,
  runCommandTest,
} from '../../lib/commands/command-test-run'
import CommandTestRun from './CommandTestRun.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))
vi.mock(
  import('../../lib/commands/command-test-run'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    runCommandTest: vi.fn(),
  })
)
const { session } = vi.hoisted(() => ({
  session: { persist: vi.fn(async () => {}), isSaved: vi.fn(() => true) },
}))
vi.mock('../../stores/ipc', () => ({ useIpcStore: () => ({ call: vi.fn() }) }))
vi.mock('../../stores/desktop', () => ({
  useDesktopStore: () => ({ userConfig: { commands: [] } }),
}))
vi.mock('../../stores/settings-session', () => ({
  useSettingsSessionStore: () => session,
}))
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

const script = (command = 'echo hi'): CommandConfig => ({
  ...createCommand('script', 'sc1'),
  name: 'Echo',
  toolConfig: { command, workingDirectory: '' },
})

const mountRun = (command = script()) =>
  mount(CommandTestRun, { props: { command } })

const runWith = async (result: CommandTestResult) => {
  vi.mocked(runCommandTest).mockResolvedValueOnce(result)
  const wrapper = mountRun()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  return wrapper
}

describe('CommandTestRun.vue', () => {
  beforeEach(() => vi.mocked(runCommandTest).mockReset())

  it('shows the exit code and both streams of a script', async () => {
    const wrapper = await runWith({
      kind: 'script',
      result: { success: false, exitCode: 2, stdout: '', stderr: 'Boom' },
    } as CommandTestResult)
    expect(wrapper.text()).toContain('commands.testExitCode:{"code":2}')
    expect(wrapper.text()).toContain('—')
    expect(wrapper.get('pre.is-error').text()).toBe('Boom')
  })

  it('shows a script killed without an exit code', async () => {
    const wrapper = await runWith({
      kind: 'script',
      result: { success: false, exitCode: null, stdout: 'out', stderr: '' },
    } as CommandTestResult)
    expect(wrapper.text()).toContain('commands.testNoExitCode')
    expect(wrapper.find('pre.is-error').exists()).toBe(false)
  })

  it('shows the output of a tool', async () => {
    const wrapper = await runWith({ kind: 'output', output: 'Result' })
    expect(wrapper.get('pre').text()).toBe('Result')
  })

  it('joins the translated and raw parts of an error', async () => {
    const wrapper = await runWith({
      kind: 'error',
      messageKey: 'commands.toolMissing',
      message: 'details',
    })
    expect(wrapper.get('.is-error').text()).toBe(
      'commands.toolMissing: details'
    )
  })

  it('stops a running test', async () => {
    vi.mocked(runCommandTest).mockImplementationOnce(
      (_command, _text, _tools, _deps, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ kind: 'cancelled' }))
        )
    )
    const wrapper = mountRun()
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('commands.testRunning')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('commands.testCancelled')
    expect(wrapper.text()).toContain('commands.testRun')
  })

  it('saves the settings before running and finds the stored command', async () => {
    vi.mocked(runCommandTest).mockImplementationOnce(
      async (_command, _text, _tools, deps) => {
        await deps.saveCommand('sc1')
        return { kind: 'output', output: '' }
      }
    )
    const wrapper = mountRun()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(session.persist).toHaveBeenCalledOnce()
  })

  it('drops a result once the configuration changes', async () => {
    const wrapper = await runWith({ kind: 'output', output: 'Result' })
    await wrapper.setProps({ command: script('echo bye') })
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('refuses to run a command with issues', () => {
    const wrapper = mountRun(script(''))
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('commands.testFixIssues')
  })
})
