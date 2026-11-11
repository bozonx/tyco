<template>
  <div class="voice-actions">
    <template v-if="compact && chat">
      <ShortcutButton
        v-if="cancelShortcut"
        :size="compact ? 'sm' : 'md'"
        :keys="['Esc']"
        :disabled="isFinishing"
        @click="cancel"
      >
        {{ t('common.cancel') }}
      </ShortcutButton>
      <ShortcutButton
        v-else
        size="sm"
        :keys="[]"
        :disabled="isFinishing"
        :title="t('chat.voiceCancelHint')"
        @click="cancel"
        >{{ t('common.cancel') }}</ShortcutButton
      >
      <ShortcutButton
        :size="compact ? 'sm' : 'md'"
        :keys="['Shift', 'Space']"
        :title="t('chat.voiceSendNow')"
        :disabled="isFinishing"
        @click="() => finish('submit')"
      >
        {{ t('chat.voiceSendNow') }}
      </ShortcutButton>
      <ShortcutButton
        :size="compact ? 'sm' : 'md'"
        :keys="primaryKeys"
        variant="primary"
        :disabled="isFinishing"
        @click="() => finish('insert')"
      >
        {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
      </ShortcutButton>
    </template>
    <template v-else>
      <ShortcutButton
        v-if="compact"
        :size="compact ? 'sm' : 'md'"
        :keys="['Esc']"
        @click="cancel"
      >
        {{ t('common.cancel') }}
      </ShortcutButton>
      <template v-if="finishBehavior === 'submitToChat'">
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="['Tab']"
          :disabled="isFinishing"
          @click="() => finish('next')"
        >
          {{ t('menu.actions') }}
        </ShortcutButton>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="secondaryKeys"
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ t('menu.voiceToInput') }}
        </ShortcutButton>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="primaryKeys"
          variant="primary"
          :disabled="isFinishing"
          @click="() => finish('submit')"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.voiceSend') }}
        </ShortcutButton>
      </template>
      <template v-else>
        <ShortcutButton
          v-if="finishBehavior === 'insertIntoTarget'"
          :size="compact ? 'sm' : 'md'"
          :keys="['Tab']"
          :disabled="isFinishing"
          @click="() => finish('next')"
        >
          {{ t('menu.actions') }}
        </ShortcutButton>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="primaryKeys"
          variant="primary"
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
        </ShortcutButton>
      </template>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type {
  VoiceFinishBehavior,
  VoiceFinishIntent,
} from '../../lib/stt/voice-finish-intent'
import ShortcutButton from '../overlay/ShortcutButton.vue'

const props = defineProps<{
  compact?: boolean
  chat?: boolean
  cancelShortcut?: boolean
  finishBehavior?: VoiceFinishBehavior
  /** The global hotkey that also presses the primary button */
  finishHotkey?: string
  isFinishing: boolean
  finish: (intent?: VoiceFinishIntent) => Promise<void>
  cancel: () => Promise<void>
}>()
const { t } = useI18n()
const insertLabelKey = computed(() =>
  props.finishBehavior === 'insertIntoTarget'
    ? 'action.insertIntoWindow'
    : 'menu.finish'
)
const primaryKeys = computed(() =>
  props.finishHotkey
    ? ['Space', 'Enter', props.finishHotkey]
    : ['Space', 'Enter']
)
const secondaryKeys = ['Shift', 'Space']
</script>

<style scoped>
.voice-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
</style>
