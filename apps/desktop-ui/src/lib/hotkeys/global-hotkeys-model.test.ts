import type { HotkeyProviderInfo } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import { createGlobalHotkeysModel } from './global-hotkeys-model'

function fixture() {
  let onChanged: (() => void) | undefined
  const unlisten = vi.fn()
  const info: HotkeyProviderInfo = {
    provider: 'global-shortcut',
    canConfigure: false,
    actions: {},
    systemTriggers: {},
    registered: false,
    defaults: {},
    commands: {},
    platform: 'linux',
  }
  const deps = {
    getProviderInfo: vi.fn(async () => ({
      success: true as const,
      result: info,
    })),
    listenHotkeysChanged: vi.fn(async (handler: () => void) => {
      onChanged = handler
      return unlisten
    }),
    getConfiguredHotkey: vi.fn((mode: string) =>
      mode === 'voice' ? 'Ctrl+Alt+V' : ''
    ),
    suspendHotkeys: vi.fn(async () => ({
      success: true as const,
      result: undefined,
    })),
    configureHotkeys: vi.fn(async () => ({
      success: false as const,
      error: 'Portal unavailable',
    })),
    rebindHotkeys: vi.fn(async () => ({ success: false as const, error: '' })),
  }
  const model = createGlobalHotkeysModel(deps)
  return { deps, model, unlisten, triggerChanged: () => onChanged?.() }
}

describe('createGlobalHotkeysModel', () => {
  it('loads provider info once, reacts to change events, and cleans up on dispose', async () => {
    const f = fixture()
    await f.model.load()
    await f.model.load()

    expect(f.deps.getProviderInfo).toHaveBeenCalledTimes(1)
    expect(f.model.shortcutLabel('voice')).toBe('Ctrl+Alt+V')

    f.triggerChanged()
    expect(f.deps.getProviderInfo).toHaveBeenCalledTimes(2)

    f.model.dispose()
    expect(f.unlisten).toHaveBeenCalledOnce()
  })

  it('tracks configure and rebind errors', async () => {
    const f = fixture()
    await f.model.configureHotkeys('Fallback configure error')
    expect(f.model.portalError.value).toBe('Portal unavailable')

    await f.model.rebindHotkeys('Fallback rebind error')
    expect(f.model.isRebinding.value).toBe(false)
    expect(f.model.portalError.value).toBe('Fallback rebind error')
  })
})
