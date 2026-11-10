<template>
  <FieldRow
    class="listen-source-row"
    :nested="nested"
    :separator="separator"
    :label="t('listen.sourceLabel')"
    :info="t('listen.sourceInfo')"
    :warning="canListen ? undefined : t('listen.unavailable')"
  >
    <template v-if="showDeviceScope" #info><DeviceScopeBadge /></template>
    <div class="listen-source-field">
      <ListenSourcePicker
        :source="source"
        :app-label="stt.listenAppLabel"
        @select="select"
      />
      <FieldInput
        v-if="desktopStore.desktopState.canListenToApps"
        size="sm"
        :model-value="stt.listenAppId ?? ''"
        :placeholder="t('listen.appIdPlaceholder')"
        @update:model-value="setAppId(String($event))"
      />
    </div>
  </FieldRow>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { configuredListenSource } from '../../lib/listen/listen-model'
import { useDesktopStore } from '../../stores/desktop'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import ListenSourcePicker from '../listen/ListenSourcePicker.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import type { CaptureSource } from '@tyco/shared'

withDefaults(
  defineProps<{
    nested?: boolean
    separator?: boolean
    showDeviceScope?: boolean
  }>(),
  { nested: true, separator: false, showDeviceScope: false }
)

const { t } = useI18n()
const desktopStore = useDesktopStore()
const { draft: userConfig } = useSettingsContext()

const stt = computed(() => userConfig.value.stt)
const canListen = computed(() => desktopStore.desktopState.canListen)
const source = computed(() => configuredListenSource(stt.value.listenAppId))

/** An application is kept by its id, never by a process id */
function select(next: CaptureSource, label?: string) {
  if (next.kind === 'application') {
    userConfig.value.stt.listenAppId = next.appId
    userConfig.value.stt.listenAppLabel = label ?? next.appId
    return
  }
  delete userConfig.value.stt.listenAppId
  delete userConfig.value.stt.listenAppLabel
}

function setAppId(value: string) {
  const appId = value.trim()
  if (!appId) {
    select({ kind: 'systemMix' })
    return
  }
  userConfig.value.stt.listenAppId = appId
  userConfig.value.stt.listenAppLabel = appId
}
</script>

<style scoped>
.listen-source-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  width: 100%;
}
</style>
