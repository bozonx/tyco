<template>
  <div class="voice-actions">
    <template v-if="compact && chat">
      <ShortcutButton
        :sm="compact"
        :keys="['Space', 'Enter']"
        :icon="insertIcon"
        primary
        :disabled="isFinishing"
        @click="() => finish('insert')"
      >
        {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
      </ShortcutButton>
      <Button
        :sm="compact"
        ghost
        square
        :title="t('chat.voiceCancelHint')"
        :disabled="isFinishing"
        @click="cancel"
      >
        <Icon icon="mdi:close" height="18" />
      </Button>
      <Button
        :sm="compact"
        square
        :title="t('chat.voiceSendHint')"
        :disabled="isFinishing"
        @click="() => finish('submit')"
      >
        <Icon icon="mdi:arrow-up" height="19" />
      </Button>
    </template>
    <template v-else>
      <template v-if="quickSend">
        <ShortcutButton
          :sm="compact"
          :keys="submitKeys"
          icon="mdi:send"
          primary
          :disabled="isFinishing"
          @click="() => finish('submit')"
        >
          {{ isFinishing ? t('common.inProgress') : t('menu.voiceSend') }}
        </ShortcutButton>
        <ShortcutButton
          :sm="compact"
          :keys="['Shift', 'Enter']"
          icon="mdi:form-textbox"
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ t('menu.voiceToInput') }}
        </ShortcutButton>
        <ShortcutButton
          :sm="compact"
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
          :sm="compact"
          :keys="['Space', 'Enter']"
          :icon="insertIcon"
          primary
          :disabled="isFinishing"
          @click="() => finish('insert')"
        >
          {{ isFinishing ? t('common.inProgress') : t(insertLabelKey) }}
        </ShortcutButton>
        <ShortcutButton
          v-if="withNext"
          :sm="compact"
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
        :sm="compact"
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
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import Button from '../common/Button.vue'
import ShortcutButton from '../common/ShortcutButton.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  compact?: boolean
  chat?: boolean
  quickSend?: boolean
  withNext?: boolean
  isFinishing: boolean
  finish: (intent?: VoiceFinishIntent) => Promise<void>
  cancel: () => Promise<void>
}>()
const { t } = useI18n()
const insertLabelKey = computed(() =>
  props.withNext ? 'action.insertIntoWindow' : 'menu.finish'
)
const insertIcon = computed(() =>
  props.withNext ? 'mdi:application-export' : 'mdi:check'
)
const submitKeys = ['Space', 'Enter']
</script>
