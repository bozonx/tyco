<template>
  <Teleport to="body">
    <dialog
      v-bind="$attrs"
      @keydown.stop
      ref="dialog"
      class="app-dialog"
      :class="{ 'app-dialog--content': size === 'content' }"
      :aria-labelledby="labelledby"
      :aria-describedby="describedby"
      :aria-label="label"
      @cancel.prevent="emit('close')"
      @click="onBackdropClick"
    >
      <slot />
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  open: boolean
  size?: 'sm' | 'content'
  label?: string
  labelledby?: string
  describedby?: string
}>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null
let version = 0

function restoreFocus() {
  if (previousFocus?.isConnected) previousFocus.focus()
  previousFocus = null
}

watch(
  () => props.open,
  async (open) => {
    const current = ++version
    await nextTick()
    if (current !== version || !dialog.value) return
    if (open && !dialog.value.open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      dialog.value.showModal()
    } else if (!open && dialog.value.open) {
      dialog.value.close()
      restoreFocus()
    }
  },
  { immediate: true }
)

function onBackdropClick(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  ) {
    emit('close')
  }
}

onBeforeUnmount(() => {
  version++
  if (dialog.value?.open) dialog.value.close()
  restoreFocus()
})
</script>

<style scoped>
.app-dialog {
  width: min(100% - 2 * var(--space-lg), 24rem);
  max-height: calc(100dvh - 2 * var(--space-lg));
  margin: auto;
  padding: var(--space-lg);
  overflow: auto;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-surface-raised);
  color: var(--color-base-content);
  box-shadow: var(--app-shadow-lg);
}
.app-dialog--content {
  width: fit-content;
  max-width: calc(100vw - 2 * var(--space-lg));
  padding: var(--space-md);
  background: var(--app-surface);
}
.app-dialog::backdrop {
  background: var(--app-overlay-bg);
  backdrop-filter: var(--app-overlay-backdrop);
}
</style>
