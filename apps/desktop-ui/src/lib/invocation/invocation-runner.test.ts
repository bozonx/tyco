import { describe, expect, it, vi } from 'vitest'

import { createToolRegistry } from '../tools/tool-registry'
import {
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
  type ToolResult,
} from '../tools/tool-types'
import { createInvocationRunner } from './invocation-runner'
import type { Invocation } from './invocation-types'

const echoTool = (
  extra: Partial<ToolDefinition> = {},
  result: ToolResult = { ok: true, content: 'ECHO' }
): ToolDefinition => ({
  id: 'core.echo',
  labelKey: 'tools.echo',
  description: 'Echoes the text',
  inputSchema: TEXT_INPUT_SCHEMA,
  run: vi.fn(async () => result),
  ...extra,
})

/** A built-in action: no command of the library stands behind it */
const builtin: Invocation = {
  toolId: 'core.echo',
  toolConfig: {},
  label: 'Echo',
}

function setup(tool: ToolDefinition = echoTool()) {
  const deps = {
    tools: createToolRegistry([tool]),
    showToast: vi.fn(),
    showError: vi.fn(),
    showText: vi.fn(),
    showResultMenu: vi.fn(),
    closeWindow: vi.fn(),
    copyText: vi.fn(async () => {}),
  }
  return { deps, tool, runner: createInvocationRunner(deps) }
}

describe('built-in invocations', () => {
  it('runs a tool with no command behind it', async () => {
    const { tool, runner, deps } = setup()
    const outcome = await runner.run(builtin, 'hello')
    expect(outcome).toEqual({ success: true })
    expect(tool.run).toHaveBeenCalledWith(
      expect.objectContaining({ input: { text: 'hello' }, source: 'menu' })
    )
    expect(vi.mocked(tool.run).mock.calls[0]?.[0]).not.toHaveProperty('command')
    expect(deps.showResultMenu).toHaveBeenCalledWith('ECHO', 'hello')
  })

  it('names the invocation when its tool is unavailable', async () => {
    const { tool, runner, deps } = setup(
      echoTool({ unavailableReason: () => 'commands.noLlm' })
    )
    const outcome = await runner.run(builtin, 'hello')
    expect(outcome).toEqual({ success: false, message: 'commands.noLlm' })
    expect(tool.run).not.toHaveBeenCalled()
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.commandUnavailable',
      'Echo'
    )
  })

  it('reports a tool that is not registered', async () => {
    const { runner } = setup()
    const outcome = await runner.run({ ...builtin, toolId: 'core.gone' }, 'x')
    expect(outcome).toEqual({ success: false, message: 'commands.toolMissing' })
  })

  it('hands the output to the caller of a transform', async () => {
    const { runner, deps } = setup()
    const result = await runner.transform(builtin, 'hello')
    expect(result).toEqual({ ok: true, content: 'ECHO' })
    expect(deps.showResultMenu).not.toHaveBeenCalled()
    expect(deps.showToast).not.toHaveBeenCalled()
  })

  it('tells a transform why the tool cannot run', async () => {
    const { runner } = setup(
      echoTool({ unavailableReason: () => 'tools.noLlm' })
    )
    expect(await runner.transform(builtin, 'hello')).toEqual({
      ok: false,
      messageKey: 'tools.noLlm',
    })
  })

  it('copies the output where the context asks for it', async () => {
    const { runner, deps } = setup()
    const outcome = await runner.run(
      {
        ...builtin,
        launcherSink: { withSelection: 'copy', withoutSelection: 'copy' },
      },
      'hello',
      { source: 'launcher' }
    )
    expect(outcome).toEqual({ success: true })
    expect(deps.copyText).toHaveBeenCalledWith('ECHO')
    expect(deps.closeWindow).toHaveBeenCalled()
  })
})
