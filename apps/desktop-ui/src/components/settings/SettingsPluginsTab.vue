<template>
  <div class="flex flex-col gap-3">
    <button
      class="btn btn-sm self-start"
      :disabled="installation.busy.value"
      @click="installation.inspect()"
    >
      {{ t('settings.installPluginPackage') }}
    </button>
    <div
      v-if="installation.preview.value"
      class="surface p-3 flex flex-col gap-2"
    >
      <p class="font-medium">
        {{
          installation.preview.value.manifest.label ||
          installation.preview.value.manifest.id
        }}
        · {{ installation.preview.value.manifest.version }}
      </p>
      <p class="text-sm text-muted">{{ t('settings.pluginTrustNotice') }}</p>
      <p class="text-sm text-muted">
        {{ t('settings.pluginCapabilities') }}:
        {{
          installation.preview.value.manifest.capabilities
            .map((capability) => t(`settings.pluginCapability.${capability}`))
            .join(', ') || t('settings.pluginCapability.none')
        }}
      </p>
      <div class="flex gap-2">
        <button
          class="btn btn-sm btn-primary"
          :disabled="installation.busy.value"
          @click="installation.install()"
        >
          {{ t('settings.installTrustedPlugin') }}
        </button>
        <button
          class="btn btn-sm"
          :disabled="installation.busy.value"
          @click="installation.cancel()"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
    <div v-if="installedPlugins.length === 0" class="text-sm text-muted">
      {{ t('settings.noInstalledPlugins') }}
    </div>

    <div
      v-for="plugin of installedPlugins"
      :key="plugin.name"
      class="surface plugin-card"
      :class="{ 'is-disabled': !plugin.enabled }"
      :data-plugin="plugin.name"
      role="button"
      tabindex="0"
      @click="openPluginSettings(plugin.name)"
      @keydown.enter.prevent="openPluginSettings(plugin.name)"
      @keydown.space.prevent="openPluginSettings(plugin.name)"
    >
      <div class="plugin-card-header">
        <div class="plugin-icon">
          <Icon icon="mdi:puzzle-outline" height="18" />
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <h3 class="font-medium text-sm leading-tight">
            {{
              plugin.labelKey ? t(plugin.labelKey) : plugin.label || plugin.name
            }}
          </h3>
          <p class="text-xs text-muted">
            {{ plugin.version
            }}<span v-if="plugin.status">
              · {{ t(`settings.pluginStatus.${plugin.status}`) }}</span
            >
          </p>
          <p v-if="plugin.error" class="text-xs text-error mt-0.5">
            {{ t('settings.pluginPackageFailed', { detail: plugin.error }) }}
          </p>
          <p
            v-if="plugin.descriptionKey || plugin.description"
            class="text-xs text-muted mt-0.5"
          >
            {{
              plugin.descriptionKey
                ? t(plugin.descriptionKey)
                : plugin.description
            }}
          </p>
        </div>

        <button
          v-if="plugin.canRestore"
          class="btn btn-sm"
          :disabled="installation.busy.value"
          @click.stop="installation.restore(plugin.name)"
        >
          {{ t('settings.restorePluginPackage') }}
        </button>
        <button
          v-if="!builtinPluginIds?.includes(plugin.name)"
          class="btn btn-sm"
          :disabled="installation.busy.value"
          @click.stop="installation.remove(plugin.name)"
        >
          {{ t('settings.removePluginPackage') }}
        </button>
        <div class="plugin-toggle" @click.stop>
          <FieldCheckbox
            :value="plugin.enabled"
            :title="
              plugin.enabled
                ? t('settings.pluginEnabled')
                : t('settings.pluginDisabled')
            "
            @update:value="setPluginEnabled(plugin.name, $event)"
          />
        </div>

        <Icon
          icon="mdi:chevron-right"
          height="20"
          class="plugin-chevron text-muted"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { createPluginInstallation } from '../../lib/plugins/plugin-installation'
import { resolveInstalledPlugins } from '../../lib/plugins/plugin-settings'
import {
  builtinPluginIds,
  pluginIndexes,
  pluginRuntimeStates,
  usePlugins,
} from '../../plugins'
import { useIpcStore } from '../../stores/ipc'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  userConfig: { plugins?: Record<string, unknown> }
}>()

const emit = defineEmits<{
  'update:pluginEnabled': [pluginName: string, enabled: boolean]
  selectPlugin: [pluginName: string]
}>()

const { t } = useI18n()
const ipc = useIpcStore()
const { toast } = useToast()
const requireResult = <T,>(result: {
  success: boolean
  result?: T
  error?: string
}): T | undefined => {
  if (!result.success)
    throw new Error(result.error ?? 'Plugin operation failed')
  return result.result
}
const installation = createPluginInstallation({
  inspect: async () =>
    requireResult(await ipc.callFunction('inspectPluginPackage', [])) ?? null,
  install: async (preview) => {
    requireResult(await ipc.callFunction('installPluginPackage', [preview]))
  },
  restore: async (id) => {
    requireResult(await ipc.callFunction('restorePluginPackage', [id]))
  },
  remove: async (id) => {
    requireResult(await ipc.callFunction('removePluginPackage', [id]))
  },
  refresh: () => usePlugins().refreshInstalledPlugins(),
  reservedIds: builtinPluginIds ?? [],
  reportError: (error) =>
    toast('settings.pluginPackageFailed', 'error', {
      detail: error instanceof Error ? error.message : String(error),
    }),
})

const installedPlugins = computed(() => {
  return resolveInstalledPlugins(
    pluginIndexes,
    props.userConfig,
    pluginRuntimeStates ?? {}
  )
})

const setPluginEnabled = (pluginName: string, enabled: boolean) => {
  emit('update:pluginEnabled', pluginName, enabled)
}

const openPluginSettings = (pluginName: string) => {
  emit('selectPlugin', pluginName)
}
</script>

<style scoped>
.plugin-card {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
  cursor: pointer;
  user-select: none;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.plugin-card:hover {
  background-color: var(--app-surface-raised);
  border-color: var(--app-border-strong);
}

.plugin-card:focus-visible {
  outline: none;
  box-shadow: var(--app-focus-ring);
}

.plugin-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
}

.plugin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.plugin-card.is-disabled .plugin-icon {
  background-color: var(--app-hover);
  color: var(--app-text-faint);
}

.plugin-toggle {
  display: flex;
  align-items: center;
}

.plugin-chevron {
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}

.plugin-card:hover .plugin-chevron {
  transform: translateX(2px);
  color: var(--color-base-content);
}
</style>
