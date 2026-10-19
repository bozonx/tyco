<template>
  <div class="plugins-tab">
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
    <StateMessage
      v-if="installedPlugins.length === 0"
      density="compact"
      :message="t('settings.noInstalledPlugins')"
    />

    <PluginCard
      v-for="plugin of installedPlugins"
      :key="plugin.pluginId"
      :plugin="plugin"
      openable
      @open="navigate(pluginTab(plugin.pluginId))"
      @update:enabled="operations.updatePluginEnabled(plugin.pluginId, $event)"
    >
      <template #meta>
        <p class="text-xs text-muted">
          {{ plugin.version
          }}<span v-if="plugin.status">
            · {{ t(`settings.pluginStatus.${plugin.status}`) }}</span
          >
        </p>
        <InlineNotice
          v-if="plugin.error"
          kind="error"
          announcement="assertive"
          :message="t('settings.pluginPackageFailed', { detail: plugin.error })"
        />
      </template>
      <template
        v-if="plugin.canRestore || !builtinPluginIds?.includes(plugin.pluginId)"
        #actions
      >
        <Button
          v-if="plugin.canRestore"
          :disabled="installation.isBusy.value"
          variant="neutral"
          size="sm"
          @click="installation.restore(plugin.pluginId)"
        >
          {{ t('settings.restorePluginPackage') }}
        </Button>
        <Button
          v-if="!builtinPluginIds?.includes(plugin.pluginId)"
          :disabled="installation.isBusy.value"
          variant="danger-ghost"
          size="sm"
          @click="installation.remove(plugin.pluginId)"
        >
          {{ t('settings.removePluginPackage') }}
        </Button>
      </template>
    </PluginCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { builtinPluginIds } from '../../lib/plugins/builtin-plugins'
import { createPluginInstallation } from '../../lib/plugins/plugin-installation'
import { resolveInstalledPlugins } from '../../lib/plugins/plugin-settings'
import { pluginTab } from '../../lib/settings/settings-navigation'
import { useIpcStore } from '../../stores/ipc'
import { usePluginRuntimeStore } from '../../stores/plugin-runtime'
import Button from '../common/Button.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import PluginCard from './PluginCard.vue'

const plugins = usePluginRuntimeStore()
const { pluginFactories, pluginRuntimeStates } = plugins

const { t } = useI18n()
const { draft, operations, navigate } = useSettingsContext()
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
    requireResult(await ipc.call('pick_plugin_package')) ?? null,
  install: async (preview) => {
    requireResult(
      await ipc.call('install_plugin_package', {
        inspectionId: preview.inspectionId,
      })
    )
  },
  restore: async (id) => {
    requireResult(await ipc.call('restore_previous_plugin_package', { id }))
  },
  remove: async (id) => {
    requireResult(await ipc.call('uninstall_plugin_package', { id }))
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
    draft.value,
    pluginRuntimeStates ?? {}
  )
})
</script>

<style scoped>
.plugins-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
</style>
