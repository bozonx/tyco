<template>
  <div class="voice-actions">
    <span
      v-if="notice"
      class="voice-actions-notice"
      role="status"
      :title="notice.text"
    >
      <AppIcon
        :icon="notice.icon"
        size="sm"
        class="voice-actions-notice-icon"
      />
      <span class="voice-actions-notice-text">{{ notice.text }}</span>
    </span>
    <template v-if="finishBehavior === 'prompt'">
      <ShortcutButton
        v-if="hasText"
        :size="compact ? 'sm' : 'md'"
        :keys="['Shift', 'Space']"
        :disabled="isFinishing"
        @click="() => finish('submit')"
        >{{ t('chat.voiceSendNow') }}</ShortcutButton
      >
      <ShortcutButton
        :size="compact ? 'sm' : 'md'"
        :keys="primaryKeys"
        variant="primary"
        :loading="isFinishing"
        :disabled="isFinishing"
        @click="() => finish('insert')"
        >{{
          isFinishing
            ? t('common.inProgress')
            : t(hasText ? 'menu.toPrompt' : 'menu.typeText')
        }}</ShortcutButton
      >
    </template>
    <template v-else-if="compact && chat">
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
        :loading="isFinishing"
        :disabled="isFinishing"
        @click="() => finish('insert')"
      >
        {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
      </ShortcutButton>
    </template>
    <template v-else>
      <template v-if="finishBehavior === 'submitToChat'">
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="[]"
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
          :loading="isFinishing"
          :disabled="isFinishing"
          @click="() => finish('submit')"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.voiceSend') }}
        </ShortcutButton>
      </template>
      <template v-else>
        <ShortcutButton
          v-if="isExternal"
          :size="compact ? 'sm' : 'md'"
          :keys="hasNoTarget ? primaryKeys : ['Shift', 'Space']"
          :variant="hasNoTarget ? 'primary' : 'ghost'"
          :disabled="isFinishing"
          @click="() => finish('next')"
        >
          {{ t('menu.actions') }}
        </ShortcutButton>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="hasNoTarget ? [] : primaryKeys"
          :variant="hasNoTarget ? 'ghost' : 'primary'"
          :loading="isFinishing && !hasNoTarget"
          :disabled="isFinishing || hasNoTarget"
          :title="isExternal ? insertTarget.title.value : undefined"
          @click="() => finish('insert')"
        >
          {{
            isFinishing && !hasNoTarget ? t('common.inProgress') : insertLabel
          }}
        </ShortcutButton>
      </template>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useInsertTarget } from '../../composables/use-insert-target'
import { usePageFocus } from '../../composables/use-page-focus'
import { isQuickWindow } from '../../lib/desktop/window'
import type {
  VoiceFinishBehavior,
  VoiceFinishIntent,
} from '../../lib/stt/voice-finish-intent'
import AppIcon from '../common/AppIcon.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'

const props = defineProps<{
  hasText?: boolean
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
/** The text goes to another application's window */
const isExternal = computed(() => props.finishBehavior === 'insertIntoTarget')
const insertTarget = useInsertTarget()
/**
 * The window was closed, or Tyco was opened without one: the text then stays
 * for the actions, and the insert button cannot be pressed
 */
const hasNoTarget = computed(
  () => isExternal.value && !insertTarget.canInsert.value
)
const insertLabel = computed(() =>
  isExternal.value ? insertTarget.label.value : t(insertLabelKey.value)
)
const { isFocusAway } = usePageFocus()
/** One short line beside the buttons, never a toast over the transcript */
const notice = computed(() => {
  // the keys of the quick panel are its main controls; a main window that
  // lost the focus is just a window the user left
  if (isQuickWindow() && isFocusAway.value) {
    return { icon: 'mdi:keyboard-off-outline', text: t('menu.keyboardAway') }
  }
  if (hasNoTarget.value) {
    return { icon: 'mdi:window-close', text: t('menu.noInsertTarget') }
  }
  return undefined
})
const primaryKeys = computed(() =>
  props.finishHotkey
    ? ['Space', 'Enter', props.finishHotkey]
    : ['Space', 'Enter']
)
const secondaryKeys = ['Shift', 'Space']
</script>

<style scoped>
.voice-actions-notice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  max-width: 100%;
  margin-right: auto;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.voice-actions-notice-icon {
  flex: none;
  color: var(--color-warning);
}

.voice-actions-notice-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.voice-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
</style>
