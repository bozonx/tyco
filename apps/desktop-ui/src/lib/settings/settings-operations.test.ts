import { SUPPORTED_PLUGIN_LOCALES } from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_USER_CONFIG,
  INLINE_CORRECTION_HOTKEY_ID,
  type ActionPageConfig,
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

  it('updates action pages and enforces selection input mode on the first page', () => {
    const f = fixture()
    const pages: ActionPageConfig[] = [
      { inputMode: 'none', slots: {} },
      { inputMode: 'none', slots: {} },
    ]
    f.model.updateActionPages(pages)
    expect(f.config.actionPages[0].inputMode).toBe('selection')
    expect(f.config.actionPages[1].inputMode).toBe('none')
    expect(() => f.model.updateActionPages([])).toThrow(
      'At least one action page is required'
    )
  })

  it('stores each hotkey id where it belongs', () => {
    const f = fixture()
    f.model.updateHotkey('voice', 'Ctrl+Alt+V')
    f.model.updateHotkey('styling', 'Ctrl+Alt+Shift+T')
    f.model.updateHotkey('transformation', 'Ctrl+Alt+Shift+M')
    f.model.updateHotkey(INLINE_CORRECTION_HOTKEY_ID, 'Ctrl+Alt+F')
    f.model.updateHotkey('selectionActions', 'Ctrl+Alt+S')
    f.model.updateHotkey('selectionActionsPage2', 'Ctrl+Alt+2')
    f.model.updateHotkey('selectionActionsPage3', 'Ctrl+Alt+3')
    f.model.updateHotkey('unknown', 'Ctrl+Alt+4')
    expect(f.config.hotkeys.voice).toBe('Ctrl+Alt+V')
    expect(f.config.hotkeys.styling).toBe('Ctrl+Alt+Shift+T')
    expect(f.config.hotkeys.transformation).toBe('Ctrl+Alt+Shift+M')
    expect(f.config.hotkeys.selectionCorrection).toBe('Ctrl+Alt+F')
    expect(f.config.hotkeys.selectionActions).toBe('Ctrl+Alt+S')
    expect(f.config.hotkeys.selectionActionsPage2).toBe('Ctrl+Alt+2')
    expect(f.config.hotkeys.selectionActionsPage3).toBe('Ctrl+Alt+3')
    expect(f.config.hotkeys).not.toHaveProperty('unknown')
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
        defaultLocale: 'en-US',
        locales: Object.fromEntries(
          SUPPORTED_PLUGIN_LOCALES.map((locale) => [locale, {}])
        ),
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
