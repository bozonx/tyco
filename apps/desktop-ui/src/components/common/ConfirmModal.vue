<template>
  <BaseDialog
    :open="open"
    :labelledby="titleId"
    :describedby="messageId"
    @close="onCancel"
  >
    <div class="confirm-modal-box">
      <div class="confirm-modal-header">
        <AppIcon
          v-if="danger"
          icon="mdi:alert-circle-outline"
          class="confirm-icon danger"
          size="2xl"
        />
        <AppIcon
          v-else
          icon="mdi:help-circle-outline"
          class="confirm-icon"
          size="2xl"
        />
        <h3 :id="titleId" class="confirm-modal-title">{{ title }}</h3>
      </div>
      <p :id="messageId" class="confirm-modal-message">{{ message }}</p>
      <div class="confirm-modal-actions">
        <Button size="sm" variant="ghost" autofocus @click="onCancel">
          {{ cancelText || t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          :variant="danger ? 'danger' : 'primary'"
          @click="onConfirm"
        >
          {{ confirmText || t('common.confirm') }}
        </Button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from './AppIcon.vue'
import BaseDialog from './BaseDialog.vue'
import Button from './Button.vue'

defineProps<{
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

const { t } = useI18n()
const titleId = useId()
const messageId = useId()

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.confirm-modal-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.confirm-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.confirm-icon.danger {
  color: var(--color-error);
}

.confirm-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
}

.confirm-modal-message {
  margin: 0 0 var(--space-lg);
  color: var(--app-text-muted);
  font-size: var(--text-body);
  line-height: 1.5;
}

.confirm-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-xs);
}
</style>
