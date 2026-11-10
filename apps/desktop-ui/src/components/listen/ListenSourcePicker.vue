<template>
  <DropdownMenu
    class="listen-source-picker"
    size="sm"
    placement="top"
    max-trigger-width="12rem"
    :icon="
      source.kind === 'application'
        ? 'mdi:application-outline'
        : 'mdi:volume-high'
    "
    :label="sourceLabel"
    :title="t('listen.sourceLabel')"
    :disabled="disabled"
    :items="items"
    @open-change="onOpenChange"
  />
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type AudioAppsWatch,
  levelBars,
  watchAudioApps,
} from '../../lib/listen/audio-apps'
import { SYSTEM_MIX_SOURCE } from '../../lib/listen/listen-model'
import { clientLogger } from '../../lib/logger'
import { tauriNetIpc } from '../../lib/net/tauri-net'
import { useDesktopStore } from '../../stores/desktop'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import type { AudioApp, CaptureSource } from '@tyco/shared'

const props = defineProps<{
  source: CaptureSource
  /** What the user knows the source's application by, if not listed */
  appLabel?: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  /** `label` is what the user knows the application by */
  (e: 'select', source: CaptureSource, label?: string): void
}>()
const { t } = useI18n()
const desktopStore = useDesktopStore()

const apps = ref<AudioApp[]>([])
let watch: AudioAppsWatch | undefined
let isOpen = false
let generation = 0

const sourceLabel = computed(() => {
  if (props.source.kind !== 'application') return t('listen.systemMix')
  const appId = props.source.appId
  return (
    apps.value.find((app) => app.id === appId)?.label ?? props.appLabel ?? appId
  )
})

const items = computed<DropdownMenuItem[]>(() => {
  const list: DropdownMenuItem[] = [
    {
      label: t('listen.systemMix'),
      icon: 'mdi:volume-high',
      action: () => emit('select', SYSTEM_MIX_SOURCE),
    },
  ]
  if (!desktopStore.desktopState.canListenToApps) return list
  if (!apps.value.length)
    list.push({
      label: t('listen.noPlayingApps'),
      disabled: true,
      action: () => undefined,
    })
  for (const app of apps.value)
    list.push({
      label: `${app.label}  ${levelBars(app.level)}`,
      icon: 'mdi:application-outline',
      action: () =>
        emit('select', { kind: 'application', appId: app.id }, app.label),
    })
  return list
})

function stopWatching() {
  watch?.stop()
  watch = undefined
}

/** The streams are followed only while the list is open */
function onOpenChange(open: boolean) {
  isOpen = open
  const run = ++generation
  if (!open) {
    stopWatching()
    return
  }
  if (watch || !desktopStore.desktopState.canListenToApps) return
  void watchAudioApps(tauriNetIpc, (next) => {
    if (isOpen && run === generation) apps.value = next
  })
    .then((started) => {
      if (isOpen && run === generation) watch = started
      else started.stop()
    })
    .catch((error: unknown) =>
      clientLogger.error(
        'Could not list the playing applications',
        error,
        'stt'
      )
    )
}

onUnmounted(() => {
  isOpen = false
  generation += 1
  stopWatching()
})
</script>
