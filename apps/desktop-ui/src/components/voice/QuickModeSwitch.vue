<template>
  <Button
    class="quick-mode-switch"
    size="xs"
    variant="ghost"
    :icon="mode === 'voice' ? 'mdi:volume-high' : 'mdi:microphone'"
    :trailing-icon="'mdi:swap-horizontal'"
    :title="title"
    :disabled="disabled"
    @click="emit('switch')"
  >
    {{ buttonLabel }}
  </Button>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { isModeSwitchKey } from '../../lib/listen/quick-mode-switch'
import Button from '../common/Button.vue'

const props = defineProps<{
  /** The mode shown now: the button leads to the other one */
  mode: 'voice' | 'listen'
  /** The other mode is not available here, see `canListen` */
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'switch'): void }>()
const { t } = useI18n()

const buttonLabel = computed(() =>
  props.mode === 'voice' ? t('listen.switchToListen') : t('listen.switchToVoice')
)
const title = computed(() =>
  props.disabled ? t('listen.unavailable') : `${buttonLabel.value} (Alt+L)`
)

function onKeyDown(event: KeyboardEvent) {
  if (props.disabled || !isModeSwitchKey(event)) return
  event.preventDefault()
  emit('switch')
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.quick-mode-switch {
  flex-shrink: 0;
  gap: var(--space-2xs, 0.25rem);
}
</style>
