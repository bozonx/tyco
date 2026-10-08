<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="confirm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      @keydown.esc="onCancel"
      @click.self="onCancel"
    >
      <div class="confirm-modal-box">
        <div class="confirm-modal-header">
          <Icon
            v-if="danger"
            icon="mdi:alert-circle-outline"
            class="confirm-icon danger"
            height="22"
          />
          <Icon
            v-else
            icon="mdi:help-circle-outline"
            class="confirm-icon"
            height="22"
          />
          <h3 class="confirm-modal-title">{{ title }}</h3>
        </div>
        <p class="confirm-modal-message">{{ message }}</p>
        <div class="confirm-modal-actions">
          <Button sm ghost @click="onCancel">
            {{ cancelText || t('common.cancel') }}
          </Button>
          <button
            type="button"
            class="btn btn-sm"
            :class="danger ? 'btn-error' : 'btn-primary'"
            @click="onConfirm"
          >
            {{ confirmText || t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onUnmounted, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import Button from './Button.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

const { t } = useI18n()

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    onCancel()
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.confirm-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-overlay) + 10);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md);
  background-color: var(--app-overlay-bg);
  backdrop-filter: var(--app-overlay-backdrop);
  animation: modal-fade-in 120ms ease-out;
}

.confirm-modal-box {
  width: 100%;
  max-width: 380px;
  padding: var(--space-lg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface-raised);
  box-shadow: var(--shadow-lg, 0 10px 25px -5px rgba(0, 0, 0, 0.4));
  animation: modal-scale-in 140ms ease-out;
}

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
  font-size: 0.95rem;
  font-weight: 600;
}

.confirm-modal-message {
  margin: 0 0 var(--space-lg);
  color: var(--app-text-muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.confirm-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-xs);
}

.btn-error {
  background-color: var(--color-error);
  color: var(--color-error-content, #fff);
  border: 1px solid transparent;
}

.btn-error:hover {
  filter: brightness(0.9);
}

@keyframes modal-fade-in {
  from {
    opacity: 0;
  }
}

@keyframes modal-scale-in {
  from {
    transform: scale(0.96);
    opacity: 0;
  }
}
</style>
