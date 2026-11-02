<template>
  <div
    class="dev-quick-panel flex items-center gap-1.5 w-full flex-wrap pt-2 border-t border-[var(--app-border-subtle)] text-xs text-[var(--app-text-muted)]"
  >
    <span class="font-mono font-medium">DEV Quick:</span>
    <Button
      v-for="entry in QUICK_MODES"
      :key="entry.mode"
      size="sm"
      variant="neutral"
      :title="entry.title"
      @click="openQuick(entry.mode)"
    >
      <AppIcon :icon="entry.icon" size="sm" />
      {{ entry.label }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { desktopClient } from '../../lib/desktop/client'
import { resolveModeRoute } from '../../lib/navigation/routes'
import { appNavigation } from '../../navigation'
import { useEditorInputStore } from '../../stores/editor-input'
import { useIpcStore } from '../../stores/ipc'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import { ActivationMode } from '@tyco/shared'

const QUICK_MODES: ReadonlyArray<{
  mode: ActivationMode
  label: string
  title: string
  icon: string
}> = [
  {
    mode: ActivationMode.VOICE_COMMANDS,
    label: 'Voice Commands',
    title: 'Open Quick Voice Commands',
    icon: 'mdi:microphone-message',
  },
  {
    mode: ActivationMode.QUICK_INPUT,
    label: 'Write',
    title: 'Open Quick Write',
    icon: 'mdi:pencil-outline',
  },
  {
    mode: ActivationMode.SELECTION_ACTIONS,
    label: 'Select',
    title: 'Open Quick Select',
    icon: 'mdi:format-list-checks',
  },
  {
    mode: ActivationMode.VOICE,
    label: 'Voice',
    title: 'Open Quick Voice',
    icon: 'mdi:microphone-outline',
  },
  {
    mode: ActivationMode.TRANSLATION,
    label: 'Translate',
    title: 'Open Quick Translate',
    icon: 'mdi:translate',
  },
  {
    mode: ActivationMode.CORRECTION,
    label: 'Correction',
    title: 'Open Quick Correction',
    icon: 'mdi:text-box-edit-outline',
  },
  {
    mode: ActivationMode.STYLING,
    label: 'Styling',
    title: 'Open Quick Styling',
    icon: 'mdi:palette-outline',
  },
  {
    mode: ActivationMode.TRANSFORMATION,
    label: 'Transform',
    title: 'Open Quick Transform',
    icon: 'mdi:auto-fix',
  },
  {
    mode: ActivationMode.CUSTOM_TRANSFORMATION,
    label: 'Custom Transform',
    title: 'Open Quick Custom Transform',
    icon: 'mdi:pencil-outline',
  },
  {
    mode: ActivationMode.VOICE_TRANSFORMATION,
    label: 'Voice Transform',
    title: 'Open Quick Voice Transform',
    icon: 'mdi:microphone-outline',
  },
]

const editorInputStore = useEditorInputStore()
const ipcStore = useIpcStore()

const openQuick = async (mode: ActivationMode) => {
  const text =
    editorInputStore.selectedText || editorInputStore.value || undefined

  const res = await ipcStore.call('activate_mode', { mode, text })
  if (!res?.success) {
    desktopClient.setLocalParams({
      mode,
      selectedText: text ?? '',
      isWindowShown: true,
    })
    void appNavigation.push(resolveModeRoute(mode))
  }
}
</script>
