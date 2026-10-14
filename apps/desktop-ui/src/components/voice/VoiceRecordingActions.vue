<template>
  <div class="voice-actions">
    <template v-if="compact && chat">
      <ShortcutButton
        :size="compact ? 'sm' : 'md'"
        :keys="['Space', 'Enter']"
        :icon="insertIcon"
        variant="primary"
        :disabled="isFinishing"
        @click="() => finish('insert')"
      >
        {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
      </ShortcutButton>
      <IconButton
        :size="compact ? 'sm' : undefined"
        variant="ghost"
        :title="t('chat.voiceCancelHint')"
        :disabled="isFinishing"
        @click="cancel"
        :label="t('chat.voiceCancelHint')"
        icon="mdi:close"
      />
      <Button
        :size="compact ? 'sm' : undefined"
        square
        :title="t('chat.voiceSendHint')"
        :disabled="isFinishing"
        @click="() => finish('submit')"
      >
        <Icon icon="mdi:arrow-up" height="19" />
      </Button>
    </template>
    <template v-else>
      <template v-if="finishBehavior === 'submitToChat'">
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="submitKeys"
          icon="mdi:send"
          variant="primary"
          :disabled="isFinishing"
          @click="() => finish('submit')"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.voiceSend') }}
        </ShortcutButton>
        <ShortcutButton
          :size="compact ? 'sm' : 'md'"
          :keys="['Shift', 'Enter']"
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
          :keys="['Space', 'Enter']"
          :icon="insertIcon"
          variant="primary"
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
      <ShortcutButton
        v-if="compact"
        :size="compact ? 'sm' : 'md'"
        :keys="['Esc']"
        icon="mdi:close"
        @click="cancel"
      >
        {{ t('common.cancel') }}
      </ShortcutButton>
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
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import IconButton from '../common/IconButton.vue'
import ShortcutButton from '../common/ShortcutButton.vue'

const props = defineProps<{
  compact?: boolean
  chat?: boolean
  finishBehavior?: VoiceFinishBehavior
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
const submitKeys = ['Space', 'Enter']
</script>
