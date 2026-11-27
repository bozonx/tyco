import { describe, expect, it } from 'vitest'

import { createSystemToolProvider, SYSTEM_INFO_TOOL_NAME } from './system-tools'
import { SYSTEM_SOURCE, toolStateIn } from './tool-catalog'

const TOOL = {
  source: SYSTEM_SOURCE,
  name: SYSTEM_INFO_TOOL_NAME,
  risk: 'read' as const,
}

describe('system tools', () => {
  it('returns the details as JSON', async () => {
    const provider = createSystemToolProvider({
      details: async () => ({ localTime: 'now', timeZone: 'UTC', os: 'Linux' }),
    })
    const [tool] = await provider.tools({} as never)
    const output = await tool.execute({}, {} as never)
    expect(JSON.parse(output as string)).toEqual({
      localTime: 'now',
      timeZone: 'UTC',
      os: 'Linux',
    })
  })

  it('is never offered in "Ask AI"', () => {
    expect(toolStateIn({ kind: 'askAi', isWebEnabled: true }, TOOL)).toBe('off')
  })

  it('runs freely in a profile until the profile sets it otherwise', () => {
    const scope = (tools: Record<string, 'ask' | 'off'> = {}) => ({
      kind: 'profile' as const,
      profileId: 'p',
      settings: { sources: {}, tools },
      catalog: undefined,
    })
    expect(toolStateIn(scope(), TOOL)).toBe('allow')
    expect(
      toolStateIn(scope({ 'core:system:get_system_info': 'ask' }), TOOL)
    ).toBe('ask')
    expect(
      toolStateIn(scope({ 'core:system:get_system_info': 'off' }), TOOL)
    ).toBe('off')
  })

  it('is offered to an AI command only when the command lists it', () => {
    const scope = (listed: boolean) => ({
      kind: 'aiCommand' as const,
      commandId: 'c',
      isQuiet: true,
      tools: listed
        ? [{ sourceKind: 'core' as const, sourceId: 'system' }]
        : [],
      catalog: undefined,
    })
    expect(toolStateIn(scope(false), TOOL)).toBe('off')
    expect(toolStateIn(scope(true), TOOL)).toBe('allow')
  })
})
