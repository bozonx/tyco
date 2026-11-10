import { describe, expect, it } from 'vitest'

import {
  CHAT_TOOL_GROUPS,
  parseToolStepCount,
  toolGroupSettings,
  withToolGroup,
  withToolStepCount,
} from './chat-tool-groups'

const web = { id: 'web', defaultAccess: 'allow' as const }

describe('chat-tool-groups', () => {
  it('offers the tool groups', () => {
    expect(CHAT_TOOL_GROUPS.map((group) => group.id)).toEqual([
      'files',
      'web',
      'commands',
    ])
    const webGroup = CHAT_TOOL_GROUPS.find((g) => g.id === 'web')
    expect(webGroup?.defaultAccess).toBe('allow')
    expect(webGroup?.defaultEnabled).toBe(true)
    const commands = CHAT_TOOL_GROUPS.find((g) => g.id === 'commands')
    expect(commands?.defaultAccess).toBe('ask')
  })

  it('reads a group as off until the profile sets it unless defaultEnabled is set', () => {
    expect(toolGroupSettings(undefined, web)).toEqual({
      isEnabled: false,
      access: 'allow',
    })
    const defaultOn = {
      id: 'web',
      defaultAccess: 'allow' as const,
      defaultEnabled: true,
    }
    expect(toolGroupSettings(undefined, defaultOn)).toEqual({
      isEnabled: true,
      access: 'allow',
    })
    expect(
      toolGroupSettings(
        { groups: { web: { isEnabled: true, access: 'ask' } } },
        web
      )
    ).toEqual({ isEnabled: true, access: 'ask' })
  })

  it('changes one group and keeps the rest', () => {
    const settings = withToolGroup(
      {
        groups: { files: { isEnabled: true, access: 'ask' } },
        maxStepCount: 4,
      },
      web,
      { isEnabled: true }
    )
    expect(settings).toEqual({
      groups: {
        files: { isEnabled: true, access: 'ask' },
        web: { isEnabled: true, access: 'allow' },
      },
      maxStepCount: 4,
    })
    expect(withToolGroup(settings, web, { access: 'deny' }).groups.web).toEqual(
      { isEnabled: true, access: 'deny' }
    )
  })

  it('sets and clears the step limit', () => {
    expect(withToolStepCount(undefined, 12)).toEqual({
      groups: {},
      maxStepCount: 12,
    })
    expect(
      withToolStepCount({ groups: {}, maxStepCount: 12 }, undefined)
    ).toEqual({ groups: {} })
  })

  it('parses a typed step limit', () => {
    expect(parseToolStepCount('')).toEqual({ isValid: true })
    expect(parseToolStepCount(' 8 ')).toEqual({ value: 8, isValid: true })
    for (const text of ['0', '51', '2.5', 'many']) {
      expect(parseToolStepCount(text).isValid).toBe(false)
    }
  })
})
