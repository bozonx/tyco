<template>
  <IconButton
    class="quick-mode-switch"
    :icon="mode === 'voice' ? 'mdi:volume-high' : 'mdi:microphone'"
    :label="label"
    :title="title"
    :disabled="disabled"
    @click="emit('switch')"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { isModeSwitchKey } from '../../lib/listen/quick-mode-switch'
import IconButton from '../common/IconButton.vue'

const props = defineProps<{
  /** The mode shown now: the button leads to the other one */
  mode: 'voice' | 'listen'
  /** The other mode is not available here, see `canListen` */
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'switch'): void }>()
const { t } = useI18n()

const label = computed(() =>
  props.mode === 'voice'
    ? t('listen.switchToListen')
    : t('listen.switchToVoice')
)
const title = computed(() =>
  props.disabled ? t('listen.unavailable') : `${label.value} (Alt+L)`
)

function onKeyDown(event: KeyboardEvent) {
  if (props.disabled || !isModeSwitchKey(event)) return
  event.preventDefault()
  emit('switch')
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>
