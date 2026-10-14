import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import type { PluginFactory } from '../../types/plugins'
import { createCommand } from '../commands/command-config'
import { createSettingsOperations } from './settings-operations'

function fixture() {
  const config = structuredClone(DEFAULT_USER_CONFIG)
  const deps = {
    getConfig: () => config,
    pluginFactories: (): PluginFactory[] => [],
    createCommand: vi.fn((toolId: string) => createCommand(toolId, 'created')),
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
      type: 'openai-compatible',
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
    expect(f.deps.removeSecret).toHaveBeenCalledWith('provider')
    expect(f.deps.notifySecretError).toHaveBeenCalledWith(error)
    f.deps.hasSecret.mockReturnValue(false)
    await f.model.finishProviderRemoval('missing')
    expect(f.deps.removeSecret).toHaveBeenCalledTimes(1)
  })

  it('repairs page references after removing a launcher page', () => {
    const f = fixture()
    const pages = ['a', 'b', 'c'].map((id) => ({
      id,
      slots: Array<string | null>(15).fill(null),
      inputMode: 'selection' as const,
    }))
    f.config.launcherPages = pages
    f.config.mainActions = ['a', 'b', 'c'].map((pageId) => ({
      type: 'launcherPage',
      pageId,
    }))
    f.model.updateLauncherPages([pages[0], pages[2]])
    expect(f.config.mainActions).toEqual([
      { type: 'launcherPage', pageId: 'a' },
      null,
      { type: 'launcherPage', pageId: 'c' },
    ])
  })

  it('keeps stable references when pages are reordered', () => {
    const f = fixture()
    const pages = ['a', 'b'].map((id) => ({
      id,
      slots: Array<string | null>(15).fill(null),
      inputMode: 'selection' as const,
    }))
    f.config.launcherPages = pages
    f.config.mainActions = [{ type: 'launcherPage', pageId: 'a' }]
    f.model.updateLauncherPages([pages[1], pages[0]])
    expect(f.config.mainActions).toEqual([
      { type: 'launcherPage', pageId: 'a' },
    ])
    expect(() => f.model.updateLauncherPages([])).toThrow(
      'At least one launcher page is required'
    )
    expect(f.config.launcherPages).toEqual([pages[1], pages[0]])
  })

  it.each([0, 1])(
    'creates and places a command on launcher page %i',
    (page) => {
      const f = fixture()
      f.config.commands = []
      f.config.launcherPages = ['a', 'b'].map((id) => ({
        id,
        slots: Array<string | null>(15).fill(null),
        inputMode: 'selection' as const,
      }))
      const id = f.model.createLauncherCommand(2, 'script', page)
      expect(f.config.commands[0].id).toBe(id)
      expect(f.config.launcherPages[page].slots[2]).toBe(id)
    }
  )

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
    f.config.plugins.test = { enabled: true, limit: 1 }
    model.updatePluginConfig('test', { mode: 'fast' })
    expect(f.config.plugins.test).toEqual({
      enabled: true,
      mode: 'fast',
      limit: 5,
    })
    model.updatePluginEnabled('test', false)
    expect(f.config.plugins.test).toEqual({
      enabled: false,
      mode: 'fast',
      limit: 5,
    })
    model.updatePluginConfig('unknown', { value: 'custom' })
    expect(f.config.plugins.unknown).toEqual({ value: 'custom' })
  })
})
