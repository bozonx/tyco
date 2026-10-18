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
import { appNavigation } from '../../lib/navigation/navigation'
import { resolveModeRoute } from '../../lib/navigation/routes'
import { useEditorInputStore } from '../../stores/editor-input'
import { useIpcStore } from '../../stores/ipc'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import { StartMode } from '@tyco/shared'

const QUICK_MODES: ReadonlyArray<{
  mode: StartMode
  label: string
  title: string
  icon: string
}> = [
  {
    mode: StartMode.VOICE_COMMANDS,
    label: 'Voice Commands',
    title: 'Open Quick Voice Commands',
    icon: 'mdi:microphone-message',
  },
  {
    mode: StartMode.WRITE,
    label: 'Write',
    title: 'Open Quick Write',
    icon: 'mdi:pencil-outline',
  },
  {
    mode: StartMode.AI_TASKS,
    label: 'AI Tasks',
    title: 'Open Quick AI Tasks',
    icon: 'mdi:robot-outline',
  },
  {
    mode: StartMode.SELECT,
    label: 'Select',
    title: 'Open Quick Select',
    icon: 'mdi:format-list-checks',
  },
  {
    mode: StartMode.VOICE,
    label: 'Voice',
    title: 'Open Quick Voice',
    icon: 'mdi:microphone-outline',
  },
  {
    mode: StartMode.COMMAND_LAUNCHER,
    label: 'Commands',
    title: 'Open Quick Commands',
    icon: 'mdi:console-line',
  },
  {
    mode: StartMode.TRANSLATE,
    label: 'Translate',
    title: 'Open Quick Translate',
    icon: 'mdi:translate',
  },
  {
    mode: StartMode.CORRECTION,
    label: 'Correction',
    title: 'Open Quick Correction',
    icon: 'mdi:text-box-edit-outline',
  },
]

const editorInputStore = useEditorInputStore()
const ipcStore = useIpcStore()

const openQuick = async (mode: StartMode) => {
  const text =
    editorInputStore.selectedText || editorInputStore.value || undefined

  const res = await ipcStore.callFunction('activateMode', [mode, text])
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
