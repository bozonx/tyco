import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_USER_CONFIG,
  INLINE_CORRECTION_HOTKEY_ID,
  launcherPageHotkeyId,
} from '@tyco/shared'
import type { PluginFactory } from '../../types/plugins'
import { createSettingsOperations } from './settings-operations'

function fixture() {
  const config = structuredClone(DEFAULT_USER_CONFIG)
  const deps = {
    getConfig: () => config,
    pluginFactories: (): PluginFactory[] => [],
    persist: vi.fn().mockResolvedValue(undefined),
    isSaved: vi.fn(() => true),
    hasSecret: vi.fn(() => true),
    removeSecret: vi.fn().mockResolvedValue(undefined),
    notifySecretError: vi.fn(),
  }
  return { config, deps, model: createSettingsOperations(deps) }
}

describe('settings operations', () => {
  it('retains a provider key if the id is referenced again before cleanup', async () => {
    const f = fixture()
    let finish!: () => void
    f.deps.persist.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const pending = f.model.finishProviderRemoval('local')
    f.config.llm.providers.push({
      id: 'local',
      type: 'openaiCompatible',
      baseUrl: 'http://localhost:11434/v1',
    })
    finish()
    await pending
    expect(f.deps.removeSecret).not.toHaveBeenCalled()
  })
  it('waits for persistence and keeps secrets when saving fails', async () => {
    const f = fixture()
    let complete!: () => void
    f.deps.persist.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const pending = f.model.finishProviderRemoval('provider')
    expect(f.deps.removeSecret).not.toHaveBeenCalled()
    f.deps.isSaved.mockReturnValue(false)
    complete()
    await pending
    expect(f.deps.removeSecret).not.toHaveBeenCalled()
  })

  it('removes saved provider secrets and reports cleanup errors', async () => {
    const f = fixture()
    const error = new Error('Secret removal failed')
    f.deps.removeSecret.mockRejectedValue(error)
    await f.model.finishProviderRemoval('provider')
    expect(f.deps.removeSecret).toHaveBeenCalledWith('llm.provider')
    expect(f.deps.notifySecretError).toHaveBeenCalledWith(error)
    f.deps.hasSecret.mockReturnValue(false)
    await f.model.finishProviderRemoval('missing')
    expect(f.deps.removeSecret).toHaveBeenCalledTimes(1)
  })

  it('repairs page references after removing a launcher page', () => {
    const f = fixture()
    const pages = ['a', 'b', 'c'].map((id) => ({
      id,
      inputMode: 'selection' as const,
      hotkey: '',
      slots: {},
    }))
    f.config.launcherPages = pages
    f.config.mainActions = {
      q: { type: 'launcherPage', pageId: 'a' },
      w: { type: 'launcherPage', pageId: 'b' },
      e: { type: 'launcherPage', pageId: 'c' },
    }
    f.model.updateLauncherPages([pages[0], pages[2]])
    expect(f.config.mainActions).toEqual({
      q: { type: 'launcherPage', pageId: 'a' },
      e: { type: 'launcherPage', pageId: 'c' },
    })
  })

  it('keeps stable references when pages are reordered', () => {
    const f = fixture()
    const pages = ['a', 'b'].map((id) => ({
      id,
      inputMode: 'selection' as const,
      hotkey: '',
      slots: {},
    }))
    f.config.launcherPages = pages
    f.config.mainActions = { q: { type: 'launcherPage', pageId: 'a' } }
    f.model.updateLauncherPages([pages[1], pages[0]])
    expect(f.config.mainActions).toEqual({
      q: { type: 'launcherPage', pageId: 'a' },
    })
    expect(() => f.model.updateLauncherPages([])).toThrow(
      'At least one launcher page is required'
    )
    expect(f.config.launcherPages).toEqual([pages[1], pages[0]])
  })

  it('stores each hotkey id where it belongs', () => {
    const f = fixture()
    f.model.updateHotkey('voice', 'Ctrl+Alt+V')
    f.model.updateHotkey(INLINE_CORRECTION_HOTKEY_ID, 'Ctrl+Alt+F')
    f.model.updateHotkey(launcherPageHotkeyId('main'), 'Ctrl+Alt+1')
    f.model.updateHotkey(launcherPageHotkeyId('missing'), 'Ctrl+Alt+2')
    f.model.updateHotkey('unknown', 'Ctrl+Alt+3')
    expect(f.config.hotkeys.voice).toBe('Ctrl+Alt+V')
    expect(f.config.hotkeys.selectionCorrection).toBe('Ctrl+Alt+F')
    expect(f.config.launcherPages[0]?.hotkey).toBe('Ctrl+Alt+1')
    expect(f.config.hotkeys).not.toHaveProperty('unknown')
    expect(f.config.hotkeys).not.toHaveProperty(INLINE_CORRECTION_HOTKEY_ID)
  })

  it('sets and resets the vault path', () => {
    const f = fixture()
    f.model.updateVaultPath('/vault')
    expect(f.config.aiVault).toEqual({ path: '/vault' })
    f.model.updateVaultPath(undefined)
    expect(f.config.aiVault).toEqual({ path: '' })
  })

  it('applies plugin presets and preserves unrelated settings', () => {
    const f = fixture()
    f.deps.pluginFactories = () => [
      () => ({
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        apiVersion: 2,
        capabilities: [],
        defaultLocale: 'en_US',
        locales: { en_US: {}, ru_RU: {}, es_AR: {}, tr_TR: {} },
        init: () => {},
        defaultConfig: {
          fields: [],
          presets: { mode: { fast: { limit: 5 } } },
        },
      }),
    ]
    const model = createSettingsOperations(f.deps)
    f.config.plugins.test = { isEnabled: true, settings: { limit: 1 } }
    model.updatePluginConfig('test', { mode: 'fast' })
    expect(f.config.plugins.test).toEqual({
      isEnabled: true,
      settings: { mode: 'fast', limit: 5 },
    })
    model.updatePluginEnabled('test', false)
    expect(f.config.plugins.test).toEqual({
      isEnabled: false,
      settings: { mode: 'fast', limit: 5 },
    })
    model.updatePluginConfig('unknown', { value: 'custom' })
    expect(f.config.plugins.unknown).toEqual({
      isEnabled: false,
      settings: { value: 'custom' },
    })
  })
})
