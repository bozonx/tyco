import { vi } from 'vitest'
import { computed, ref } from 'vue'
import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'

import {
  SETTINGS_CONTEXT_KEY,
  type SettingsContext,
} from '../lib/settings/settings-context'
import { createSettingsOperations } from '../lib/settings/settings-operations'
import type { PluginFactory } from '../types/plugins'

/**
 * A settings context for mounting one tab: `mount(Tab, { global: { provide:
 * context.provide } })`. The given config becomes the draft itself, completed
 * with defaults, so a test can check what the tab wrote into it
 */
export function createTestSettingsContext(
  config: Partial<UserConfig> = {},
  options: {
    pluginFactories?: PluginFactory[]
    effectiveAppLanguage?: string
  } = {}
) {
  const defaults = structuredClone(DEFAULT_USER_CONFIG) as UserConfig
  for (const key of Object.keys(defaults) as (keyof UserConfig)[]) {
    if (!(key in config)) Object.assign(config, { [key]: defaults[key] })
  }
  const draft = ref(config as UserConfig)
  const deps = {
    getConfig: () => draft.value,
    pluginFactories: () => options.pluginFactories ?? [],
    persist: vi.fn().mockResolvedValue(undefined),
    isSaved: vi.fn(() => true),
    hasSecret: vi.fn(() => false),
    removeSecret: vi.fn().mockResolvedValue(undefined),
    notifySecretError: vi.fn(),
  }
  const context: SettingsContext = {
    draft,
    operations: createSettingsOperations(deps),
    effectiveAppLanguage: computed(
      () => options.effectiveAppLanguage ?? 'en_US'
    ),
    navigate: vi.fn(),
    editCommand: vi.fn(),
  }
  return {
    ...context,
    deps,
    provide: { [SETTINGS_CONTEXT_KEY as symbol]: context },
  }
}
