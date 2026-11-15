<template>
  <div class="stopped-recording-actions">
    <Button
      v-for="action in actions.others"
      :key="action"
      size="sm"
      variant="ghost"
      :icon="ACTION_ICONS[action]"
      @click="run(action)"
      >{{ t(ACTION_LABEL_KEYS[action]) }}</Button
    >
    <ShortcutButton
      v-if="props.hasNextActions"
      size="sm"
      :keys="['Shift', 'Space']"
      @click="emit('next')"
      >{{ t('menu.actions') }}</ShortcutButton
    >
    <ShortcutButton
      v-if="actions.primary"
      size="sm"
      variant="primary"
      :keys="['Space', 'Enter']"
      @click="run(actions.primary)"
      >{{ t(ACTION_LABEL_KEYS[actions.primary]) }}</ShortcutButton
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type StoppedRecordingAction,
  type StoppedRecordingCapabilities,
  stoppedRecordingActions,
} from '../../lib/voice/stopped-recording-actions'
import Button from '../common/Button.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'

const props = defineProps<{
  capabilities: StoppedRecordingCapabilities
  /** Whether there is text to open the actions for with Shift+Space. */
  hasNextActions?: boolean
}>()

const emit = defineEmits<{
  retry: []
  typeText: []
  openSettings: []
  next: []
}>()

const { t } = useI18n()

const ACTION_LABEL_KEYS: Record<StoppedRecordingAction, string> = {
  retry: 'listen.retry',
  typeText: 'menu.typeText',
  openSettings: 'common.openSettings',
}
const ACTION_ICONS: Record<StoppedRecordingAction, string | undefined> = {
  retry: undefined,
  typeText: undefined,
  openSettings: 'mdi:cog-outline',
}

function run(action: StoppedRecordingAction) {
  if (action === 'retry') emit('retry')
  else if (action === 'typeText') emit('typeText')
  else emit('openSettings')
}

const actions = computed(() => stoppedRecordingActions(props.capabilities))
</script>

<style scoped>
.stopped-recording-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
</style>
