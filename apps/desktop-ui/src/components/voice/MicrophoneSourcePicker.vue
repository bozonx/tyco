<template>
  <DropdownMenu
    size="sm"
    placement="top"
    icon="mdi:microphone"
    :label="label"
    :disabled="disabled"
    :items="items"
    @open-change="loadDevices"
  />
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { isModeSwitchKey } from '../../lib/listen/quick-mode-switch'
import { tauriNetIpc } from '../../lib/net/tauri-net'
import { listInputDevices } from '../../lib/stt/input-devices'
import { useDesktopStore } from '../../stores/desktop'
import DropdownMenu from '../common/DropdownMenu.vue'
import type { AudioInputDevice } from '@tyco/shared'

const props = defineProps<{ microphoneId?: string; disabled?: boolean }>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'switch'): void
}>()
const { t } = useI18n()
const desktop = useDesktopStore()
const devices = ref<AudioInputDevice[]>([])
const label = computed(
  () =>
    devices.value.find((device) => device.id === props.microphoneId)?.label ||
    props.microphoneId ||
    t('settings.microphoneSystemDefault')
)
const items = computed(() => [
  {
    label: t('settings.microphoneSystemDefault'),
    icon: 'mdi:microphone',
    action: () => emit('select', ''),
  },
  ...devices.value.map((device) => ({
    label: device.label,
    icon: 'mdi:microphone',
    action: () => emit('select', device.id),
  })),
  {
    label: t('listen.switchToListen'),
    icon: 'mdi:volume-high',
    disabled: !desktop.desktopState.canListen,
    action: () => emit('switch'),
  },
])
async function loadDevices(open: boolean) {
  if (!open) return
  try {
    devices.value = await listInputDevices(tauriNetIpc)
  } catch {
    devices.value = []
  }
}
function handleModeSwitch(event: KeyboardEvent) {
  if (props.disabled || !isModeSwitchKey(event)) return
  event.preventDefault()
  emit('switch')
}
onMounted(() => window.addEventListener('keydown', handleModeSwitch))
onUnmounted(() => window.removeEventListener('keydown', handleModeSwitch))
</script>
