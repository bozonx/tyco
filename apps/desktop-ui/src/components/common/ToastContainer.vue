<template>
  <div
    class="fixed bottom-4 right-4 z-[var(--z-toast)] pointer-events-none flex flex-col gap-2 items-end max-w-sm w-full px-4 sm:px-0"
    role="region"
    aria-label="Notifications"
  >
    <TransitionGroup
      name="toast"
      tag="div"
      class="flex flex-col gap-2 items-end w-full"
    >
      <div
        v-for="item in toastStore.toasts"
        :key="item.id"
        :role="item.type === 'error' ? 'alert' : 'status'"
        class="toast-card pointer-events-auto w-full max-w-[340px] flex items-start gap-2.5 px-3 py-2.5 rounded-lg border shadow-lg bg-[var(--app-surface)] text-[var(--color-base-content)] select-text"
        :class="getToastClasses(item.type)"
        @mouseenter="toastStore.pauseToast(item.id)"
        @mouseleave="toastStore.resumeToast(item.id)"
      >
        <Icon
          :icon="getToastIcon(item.type)"
          height="18"
          class="shrink-0 mt-0.5"
          :class="getToastIconClass(item.type)"
        />

        <div class="flex-1 min-w-0 pr-1">
          <div
            v-if="item.title"
            class="font-medium text-xs text-[var(--color-base-content)] mb-0.5 truncate"
          >
            {{ item.title }}
          </div>
          <div
            class="text-xs text-[var(--app-text-muted)] break-words leading-relaxed select-text"
          >
            {{ item.message }}
          </div>
        </div>

        <button
          type="button"
          tabindex="-1"
          class="shrink-0 p-1 rounded hover:bg-[var(--app-hover)] text-[var(--app-text-faint)] hover:text-[var(--color-base-content)] transition-colors -mr-1 -mt-0.5 cursor-pointer"
          aria-label="Close"
          @mousedown.prevent
          @click="toastStore.removeToast(item.id)"
        >
          <Icon icon="mdi:close" height="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { type ToastType, useToastStore } from '../../stores/toast'
import { Icon } from '@iconify/vue'

const toastStore = useToastStore()

function getToastClasses(type: ToastType): string {
  switch (type) {
    case 'success':
      return 'border-[var(--app-border)] border-l-4 border-l-[var(--color-success)]'
    case 'error':
      return 'border-[var(--app-border)] border-l-4 border-l-[var(--color-error)]'
    case 'warn':
      return 'border-[var(--app-border)] border-l-4 border-l-[var(--color-warning)]'
    case 'info':
    default:
      return 'border-[var(--app-border)] border-l-4 border-l-[var(--color-info)]'
  }
}

function getToastIcon(type: ToastType): string {
  switch (type) {
    case 'success':
      return 'mdi:check-circle'
    case 'error':
      return 'mdi:alert-circle'
    case 'warn':
      return 'mdi:alert'
    case 'info':
    default:
      return 'mdi:information'
  }
}

function getToastIconClass(type: ToastType): string {
  switch (type) {
    case 'success':
      return 'text-[var(--color-success)]'
    case 'error':
      return 'text-[var(--color-error)]'
    case 'warn':
      return 'text-[var(--color-warning)]'
    case 'info':
    default:
      return 'text-[var(--color-info)]'
  }
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(20px) scale(0.96);
}

.toast-move {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
