import type { CommandConfig, ProfileToolSettings } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  COMMANDS_SOURCE,
  FILES_SOURCE,
  MEMORY_SOURCE,
  REPLY_BLOCKS_SOURCE,
  WEB_SOURCE,
  commandRisk,
  defaultToolPolicy,
  effectiveToolPolicy,
  effectiveToolState,
  highestRisk,
  sourceKey,
  toolCallContextOf,
  toolKey,
  toolStateIn,
  withCommandSelected,
  withSourceEnabled,
  withToolState,
  type CatalogTool,
} from './tool-catalog'

const settings = (
  patch: Partial<ProfileToolSettings> = {}
): ProfileToolSettings => ({ sources: {}, tools: {}, commandIds: [], ...patch })

const webFetch: CatalogTool = {
  source: WEB_SOURCE,
  name: 'web_fetch',
  risk: 'read',
}
const plugin = (isThirdParty: boolean, risk: CatalogTool['risk']) => ({
  source: { kind: 'plugin' as const, id: 'notes' },
  name: 'append',
  risk,
  ...(isThirdParty ? { isThirdParty } : {}),
})

describe('tool catalog', () => {
  it('builds keys that cannot be confused by the separator', () => {
    expect(sourceKey(WEB_SOURCE)).toBe('core:web')
    expect(toolKey(WEB_SOURCE, 'web_fetch')).toBe('core:web:web_fetch')
    expect(toolKey({ kind: 'mcp', id: 'srv' }, 'a:b%c')).toBe(
      'mcp:srv:a%3Ab%25c'
    )
  })

  it('takes the default policy from the risk', () => {
    expect(defaultToolPolicy(webFetch)).toBe('allow')
    expect(defaultToolPolicy({ ...webFetch, risk: 'write' })).toBe('ask')
    expect(defaultToolPolicy({ ...webFetch, risk: 'external' })).toBe('ask')
    expect(
      defaultToolPolicy({ ...webFetch, risk: 'write', defaultPolicy: 'allow' })
    ).toBe('allow')
  })

  it('never lowers the policy by a risk a third party declares', () => {
    expect(defaultToolPolicy(plugin(false, 'read'))).toBe('allow')
    expect(defaultToolPolicy(plugin(true, 'read'))).toBe('ask')
    expect(
      defaultToolPolicy({ source: COMMANDS_SOURCE, name: 'x', risk: 'read' })
    ).toBe('ask')
  })

  it('has the core and plugin sources on, commands picked', () => {
    expect(effectiveToolState(undefined, undefined, webFetch)).toBe('allow')
    expect(
      effectiveToolState(undefined, undefined, plugin(false, 'read'))
    ).toBe('allow')
    const command = {
      source: COMMANDS_SOURCE,
      name: 'notes',
      risk: 'external',
    } as const
    expect(effectiveToolState(undefined, settings(), command)).toBe('off')
    expect(
      effectiveToolState(
        undefined,
        settings({ commandIds: ['notes'] }),
        command
      )
    ).toBe('ask')
  })

  it('follows the profile, then the catalog', () => {
    const off = withSourceEnabled(undefined, WEB_SOURCE, false)
    expect(effectiveToolState(undefined, off, webFetch)).toBe('off')
    const asking = withToolState(undefined, webFetch, 'ask')
    expect(effectiveToolPolicy(undefined, asking, webFetch)).toBe('ask')
    const toolOff = withToolState(undefined, webFetch, 'off')
    expect(effectiveToolPolicy(undefined, toolOff, webFetch)).toBeUndefined()
    // a plugin off everywhere is off in every profile
    const catalog = { sources: { 'plugin:notes': { isEnabled: false } } }
    expect(
      effectiveToolState(
        catalog,
        withToolState(undefined, plugin(false, 'read'), 'allow'),
        plugin(false, 'read')
      )
    ).toBe('off')
  })

  it('keeps only the differences from the defaults', () => {
    expect(withSourceEnabled(undefined, WEB_SOURCE, true).sources).toEqual({})
    expect(withToolState(undefined, webFetch, 'allow').tools).toEqual({})
    const changed = withToolState(undefined, webFetch, 'ask')
    expect(changed.tools).toEqual({ 'core:web:web_fetch': 'ask' })
    expect(withToolState(changed, webFetch, 'allow').tools).toEqual({})
    expect(withCommandSelected(undefined, 'a', true).commandIds).toEqual(['a'])
    expect(
      withCommandSelected(settings({ commandIds: ['a', 'b'] }), 'a', false)
        .commandIds
    ).toEqual(['b'])
  })

  it('gives "Ask AI" the web by its switch and the helpers only', () => {
    const on = { kind: 'askAi' as const, isWebEnabled: true }
    expect(toolStateIn(on, webFetch)).toBe('allow')
    expect(toolStateIn({ ...on, isWebEnabled: false }, webFetch)).toBe('off')
    expect(
      toolStateIn(on, { source: REPLY_BLOCKS_SOURCE, name: 'x', risk: 'read' })
    ).toBe('allow')
    for (const source of [FILES_SOURCE, MEMORY_SOURCE, COMMANDS_SOURCE])
      expect(toolStateIn(on, { source, name: 'x', risk: 'read' })).toBe('off')
    expect(toolStateIn(on, plugin(false, 'read'))).toBe('off')
  })

  it('gives a profile its memory always, the rest by its settings', () => {
    const scope = {
      kind: 'profile' as const,
      profileId: 'p',
      settings: withSourceEnabled(undefined, WEB_SOURCE, false),
      catalog: undefined,
    }
    expect(
      toolStateIn(scope, { source: MEMORY_SOURCE, name: 'x', risk: 'write' })
    ).toBe('allow')
    expect(toolStateIn(scope, webFetch)).toBe('off')
  })

  it('gives an AI command its whitelist, all allowed', () => {
    const scope = {
      kind: 'aiCommand' as const,
      commandId: 'agent',
      tools: [
        {
          sourceKind: 'core' as const,
          sourceId: 'web',
          toolName: 'web_search',
        },
        { sourceKind: 'plugin' as const, sourceId: 'notes' },
      ],
      catalog: undefined,
    }
    expect(toolStateIn(scope, { ...webFetch, name: 'web_search' })).toBe(
      'allow'
    )
    expect(toolStateIn(scope, webFetch)).toBe('off')
    expect(toolStateIn(scope, plugin(true, 'external'))).toBe('allow')
    expect(
      toolStateIn(
        {
          ...scope,
          catalog: { sources: { 'plugin:notes': { isEnabled: false } } },
        },
        plugin(true, 'external')
      )
    ).toBe('off')
    expect(
      toolStateIn(scope, {
        source: FILES_SOURCE,
        name: 'read_file',
        risk: 'read',
      })
    ).toBe('off')
    expect(toolCallContextOf(scope)).toEqual({
      kind: 'aiCommand',
      commandId: 'agent',
    })
  })

  it('rates an AI command by the riskiest tool of its whitelist', () => {
    const command = (id: string, extra: Partial<CommandConfig> = {}) =>
      ({
        id,
        operationId: 'script',
        operationConfig: {},
        ...extra,
      }) as CommandConfig
    const agent = (id: string, tools: unknown[]) =>
      command(id, { operationId: 'core.aiTask', operationConfig: { tools } })
    const commands = [
      command('reader', { aiRisk: 'read' }),
      command('unknown'),
      agent('web', [{ sourceKind: 'core', sourceId: 'web' }]),
      agent('mixed', [
        { sourceKind: 'commands', sourceId: 'commands', toolName: 'reader' },
        { sourceKind: 'commands', sourceId: 'commands', toolName: 'unknown' },
      ]),
      agent('loop', [
        { sourceKind: 'commands', sourceId: 'commands', toolName: 'loop' },
      ]),
      agent('empty', []),
    ]
    const lookup = {
      commands,
      whitelistOf: (item: CommandConfig) =>
        item.operationId === 'core.aiTask'
          ? (item.operationConfig.tools as never)
          : undefined,
    }
    const riskOf = (id: string) =>
      commandRisk(
        commands.find((item) => item.id === id)!,
        lookup
      )
    expect(riskOf('reader')).toBe('read')
    expect(riskOf('unknown')).toBe('external')
    // the web of an AI command has no leak protection
    expect(riskOf('web')).toBe('external')
    expect(riskOf('mixed')).toBe('external')
    expect(riskOf('loop')).toBe('read')
    expect(riskOf('empty')).toBe('read')
    expect(highestRisk(['read', 'destructive', 'write'])).toBe('destructive')
  })
})
