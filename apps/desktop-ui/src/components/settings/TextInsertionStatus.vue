<template>
  <div v-if="status || error" class="insertion-status">
    <template v-if="status && lines">
      <InlineNotice
        :kind="NOTICE_KINDS[lines.keys.tone]"
        :icon="NOTICE_ICONS[lines.keys.tone]"
        :message="t(lines.keys.messageKey)"
      >
        <Button
          v-if="status.keys === 'needsPermission'"
          size="sm"
          variant="primary"
          icon="mdi:keyboard-outline"
          :disabled="isRequesting"
          @click="requestPermission()"
        >
          {{ t('settings.textInsertion.allowKeyboardControl') }}
        </Button>
      </InlineNotice>
      <p v-if="status.keys === 'unavailable' && status.detail" class="detail">
        {{ status.detail }}
      </p>
      <InlineNotice
        :kind="NOTICE_KINDS[lines.target.tone]"
        :icon="NOTICE_ICONS[lines.target.tone]"
        :message="t(lines.target.messageKey)"
      />
    </template>
    <InlineNotice
      v-if="error"
      kind="error"
      icon="mdi:alert-circle-outline"
      :message="t('settings.textInsertion.checkFailed', { error })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type InsertionStatusTone,
  createTextInsertionStatusModel,
  describeKeys,
  describeTarget,
} from '../../lib/text-insertion/text-insertion-status'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import InlineNotice from '../common/InlineNotice.vue'

const NOTICE_KINDS = {
  ok: 'success',
  warning: 'warning',
  error: 'error',
} as const satisfies Record<InsertionStatusTone, string>

const NOTICE_ICONS: Record<InsertionStatusTone, string> = {
  ok: 'mdi:check-circle-outline',
  warning: 'mdi:alert-outline',
  error: 'mdi:alert-circle-outline',
}

const { t } = useI18n()
const ipc = useIpcStore()
const { status, error, isRequesting, refresh, requestPermission } =
  createTextInsertionStatusModel({
    getStatus: () => ipc.call('get_text_insertion_status'),
    requestPermission: () => ipc.call('request_text_insertion_permission'),
  })

const lines = computed(
  () =>
    status.value && {
      keys: describeKeys(status.value),
      target: describeTarget(status.value),
    }
)

// the settings tab mounts again when the user comes back to it, which
// checks again
onMounted(() => {
  void refresh()
})
</script>

<style scoped>
.insertion-status {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
}
.detail {
  margin: 0;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  overflow-wrap: anywhere;
}
</style>
