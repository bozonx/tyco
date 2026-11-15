<template>
  <DropdownMenu
    :label="t('window.cyclePosition', { position: positionLabel })"
    icon="mdi:dock-right"
    size="xs"
    square
    hide-chevron
    placement="bottom"
    align="right"
    :disabled="isSaving"
    :items="items"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import type { ActionMenuPosition } from '@tyco/shared'

const { t } = useI18n()
const desktop = useDesktopStore()
const ipc = useIpcStore()
const isSaving = ref(false)
const positions: ActionMenuPosition[] = ['center', 'right', 'bottomRight']
const position = computed(
  () => desktop.userConfig.quickWindow.actionMenuPosition ?? 'center'
)
const positionLabel = computed(() => {
  switch (position.value) {
    case 'right':
      return t('window.position.right')
    case 'bottomRight':
      return t('window.position.bottomRight')
    default:
      return t('window.position.center')
  }
})

async function setPosition(next: ActionMenuPosition) {
  if (isSaving.value || position.value === next) return
  isSaving.value = true
  try {
    const result = await desktop.updateUserConfig({
      quickWindow: {
        ...desktop.savedUserConfig.quickWindow,
        actionMenuPosition: next,
      },
    })
    if (result.success) await ipc.call('reposition_quick_window')
  } finally {
    isSaving.value = false
  }
}

async function cycle() {
  const next =
    positions[(positions.indexOf(position.value) + 1) % positions.length]!
  await setPosition(next)
}

const items = computed<DropdownMenuItem[]>(() =>
  positions.map((pos) => ({
    label:
      pos === 'right'
        ? t('window.position.right')
        : pos === 'bottomRight'
          ? t('window.position.bottomRight')
          : t('window.position.center'),
    icon: position.value === pos ? 'mdi:check' : undefined,
    action: () => setPosition(pos),
  }))
)

function onKeydown(event: KeyboardEvent) {
  if (
    event.code !== 'KeyP' ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.repeat
  )
    return
  event.preventDefault()
  event.stopImmediatePropagation()
  void cycle()
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>
