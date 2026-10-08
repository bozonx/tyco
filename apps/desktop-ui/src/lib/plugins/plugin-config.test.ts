import { describe, expect, it } from 'vitest'
import { applyPluginDefaults, getPluginState, resolvePluginConfig } from './plugin-config'

const plugin = {
  id: 'Example', name: 'Example', version: '1.0.0', apiVersion: 2, capabilities: [], defaultLocale: 'en_US', locales: { en_US: {} },
  defaultConfig: { fields: [
    { name: 'mode', type: 'select' as const, defaultValue: 'safe', options: [{ id: 'safe' }, { id: 'custom' }] },
    { name: 'enabledFeature', type: 'checkbox' as const, defaultValue: true },
  ] },
  init: () => {},
}
describe('plugin config', () => {
  it('validates fields and excludes undeclared data and host metadata', () => {
    expect(resolvePluginConfig(plugin, { mode: 'invalid', enabledFeature: 'yes', enabled: false, unknown: 'private' })).toEqual({ mode: 'safe', enabledFeature: true })
  })
  it('preserves disabled state without writing migration metadata', () => {
    expect(applyPluginDefaults([() => plugin], { Example: { mode: 'custom', enabled: false } }).Example).toEqual({ mode: 'custom', enabledFeature: true, enabled: false })
  })
  it('reads only its current identity and returns detached settings', () => {
    const states = { Other: { mode: 'custom' }, Example: { mode: 'safe' } }
    getPluginState(plugin, states).mode = 'custom'
    expect(states.Example.mode).toBe('safe')
    expect(getPluginState(plugin, { Other: states.Other })).toEqual({})
    expect(applyPluginDefaults([() => plugin], states).Other).toEqual(states.Other)
  })
})
