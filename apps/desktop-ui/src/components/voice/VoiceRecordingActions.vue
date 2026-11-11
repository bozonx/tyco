<template>
  <div class="voice-actions">
    <template v-if="compact && chat">
      <ShortcutButton
        :size="compact ? 'sm' : 'md'"
        :keys="primaryKeys"
        :icon="insertIcon"
        variant="primary"
        class="voice-action-primary"
        :disabled="isFinishing"
        @click="() => finish('insert')"
      >
        {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
      </ShortcutButton>
      <ShortcutButton
        v-if="cancelShortcut"
        :size="compact ? 'sm' : 'md'"
        :keys="['Esc']"
        icon="mdi:close"
        :disabled="isFinishing"
        @click="cancel"
      >
        {{ t('common.cancel') }}
      </ShortcutButton>
      <IconButton
        v-else
        :size="compact ? 'sm' : undefined"
        variant="ghost"
        :disabled="isFinishing"
        @click="cancel"
        :label="t('chat.voiceCancelHint')"
        icon="mdi:close"
      />
      <ShortcutButton
        :size="compact ? 'sm' : 'md'"
        :keys="['Ctrl+Enter']"
        icon="mdi:send"
        variant="primary"
        class="voice-action-primary"
        :title="t('chat.voiceSendHint')"
        :disabled="isFinishing"
        @click="() => finish('submit')"
      >
        {{ t('chat.voiceSendNow') }}
      </ShortcutButton>
    </template>
    <template v-else>
      <ShortcutButton
        v-if="compact"
        :size="compact ? 'sm' : 'md'"
        :keys="['Esc']"
        icon="mdi:close"
        @click="cancel"
      >
        {{ t('common.cancel') }}
      </ShortcutButton>
      <template v-if="finishBehavior === 'submitToChat'">
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="primaryKeys"
          icon="mdi:send"
          variant="primary"
          class="voice-action-primary"
          :disabled="isFinishing"
          @click="() => finish('submit')"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.voiceSend') }}
        </ShortcutButton>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="secondaryKeys"
          icon="mdi:form-textbox"
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ t('menu.voiceToInput') }}
        </ShortcutButton>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="['Tab']"
          icon="mdi:arrow-right"
          :disabled="isFinishing"
          @click="() => finish('next')"
        >
          {{ t('write.next') }}
        </ShortcutButton>
      </template>
      <template v-else>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="primaryKeys"
          :icon="insertIcon"
          variant="primary"
          class="voice-action-primary"
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
        </ShortcutButton>
        <ShortcutButton
          v-if="finishBehavior === 'insertIntoTarget'"
          :size="compact ? 'sm' : 'md'"
          :keys="['Tab']"
          icon="mdi:arrow-right"
          :disabled="isFinishing"
          @click="() => finish('next')"
        >
          {{ t('write.next') }}
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
import IconButton from '../common/IconButton.vue'
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
const insertIcon = computed(() =>
  props.finishBehavior === 'insertIntoTarget'
    ? 'mdi:application-export'
    : 'mdi:check'
)
const primaryKeys = computed(() =>
  props.finishHotkey
    ? ['Space', 'Enter', props.finishHotkey]
    : ['Space', 'Enter']
)
const secondaryKeys = ['Shift', 'Space', 'Enter']
</script>

<style scoped>
.voice-action-primary {
  order: 1;
}
</style>
