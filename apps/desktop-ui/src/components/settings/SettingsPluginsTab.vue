<template>
  <div class="flex flex-col gap-3">
    <Button
      class="self-start"
      :disabled="installation.isBusy.value"
      @click="installation.inspect()"
      variant="neutral"
      size="sm"
    >
      {{ t('settings.installPluginPackage') }}
    </Button>
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
        <Button
          :disabled="installation.isBusy.value"
          @click="installation.install()"
          variant="primary"
          size="sm"
        >
          {{ t('settings.installTrustedPlugin') }}
        </Button>
        <Button
          :disabled="installation.isBusy.value"
          @click="installation.cancel()"
          variant="neutral"
          size="sm"
        >
          {{ t('common.cancel') }}
        </Button>
      </div>
    </div>
    <div v-if="installedPlugins.length === 0" class="text-sm text-muted">
      {{ t('settings.noInstalledPlugins') }}
    </div>

    <div
      v-for="plugin of installedPlugins"
      :key="plugin.pluginId"
      class="surface plugin-card"
      :class="{ 'is-disabled': !plugin.isEnabled }"
      :data-plugin="plugin.pluginId"
      role="button"
      tabindex="0"
      @click="openPluginSettings(plugin.pluginId)"
      @keydown.enter.prevent="openPluginSettings(plugin.pluginId)"
      @keydown.space.prevent="openPluginSettings(plugin.pluginId)"
    >
      <div class="plugin-card-header">
        <div class="plugin-icon">
          <Icon icon="mdi:puzzle-outline" height="18" />
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <h3 class="font-medium text-sm leading-tight">
            {{
              plugin.labelKey
                ? t(plugin.labelKey)
                : plugin.label || plugin.pluginId
            }}
          </h3>
          <p class="text-xs text-muted">
            {{ plugin.version
            }}<span v-if="plugin.status">
              · {{ t(`settings.pluginStatus.${plugin.status}`) }}</span
            >
          </p>
          <StateMessage
            v-if="plugin.error"
            kind="error"
            inline
            :message="
              t('settings.pluginPackageFailed', { detail: plugin.error })
            "
          />
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

        <Button
          v-if="plugin.canRestore"
          :disabled="installation.isBusy.value"
          @click.stop="installation.restore(plugin.pluginId)"
          variant="neutral"
          size="sm"
        >
          {{ t('settings.restorePluginPackage') }}
        </Button>
        <Button
          v-if="!builtinPluginIds?.includes(plugin.pluginId)"
          :disabled="installation.isBusy.value"
          @click.stop="installation.remove(plugin.pluginId)"
          variant="neutral"
          size="sm"
        >
          {{ t('settings.removePluginPackage') }}
        </Button>
        <div class="plugin-toggle" @click.stop>
          <FieldCheckbox
            :value="plugin.isEnabled"
            :title="
              plugin.isEnabled
                ? t('settings.pluginEnabled')
                : t('settings.pluginDisabled')
            "
            @update:value="setPluginEnabled(plugin.pluginId, $event)"
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

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { builtinPluginIds } from '../../lib/plugins/builtin-plugins'
import { createPluginInstallation } from '../../lib/plugins/plugin-installation'
import { resolveInstalledPlugins } from '../../lib/plugins/plugin-settings'
import { useIpcStore } from '../../stores/ipc'
import { usePluginRuntimeStore } from '../../stores/plugin-runtime'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import StateMessage from '../common/StateMessage.vue'
import { Icon } from '@iconify/vue'

const plugins = usePluginRuntimeStore()
const { pluginFactories, pluginRuntimeStates } = plugins

const props = defineProps<{
  userConfig: { plugins?: Record<string, unknown> }
}>()

const emit = defineEmits<{
  'update:pluginEnabled': [pluginId: string, enabled: boolean]
  selectPlugin: [pluginId: string]
}>()

const { t } = useI18n()
const ipc = useIpcStore()
const { toastKey } = useToast()
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
  refresh: plugins.refreshInstalledPlugins,
  reservedIds: builtinPluginIds ?? [],
  reportError: (error) =>
    toastKey('settings.pluginPackageFailed', 'error', {
      detail: error instanceof Error ? error.message : String(error),
    }),
})

const installedPlugins = computed(() => {
  return resolveInstalledPlugins(
    pluginFactories,
    props.userConfig,
    pluginRuntimeStates ?? {}
  )
})

const setPluginEnabled = (pluginId: string, enabled: boolean) => {
  emit('update:pluginEnabled', pluginId, enabled)
}

const openPluginSettings = (pluginId: string) => {
  emit('selectPlugin', pluginId)
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
