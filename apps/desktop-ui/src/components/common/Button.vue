<template>
  <button
    ref="buttonRef"
    :class="['btn', buttonClass]"
    :type="props.type ?? 'button'"
    :disabled="props.disabled || props.loading"
    :aria-busy="props.loading || undefined"
    @click="onClick"
  >
    <span
      v-if="props.loading"
      class="loading loading-spinner loading-xs"
      aria-hidden="true"
    />
    <Icon
      v-else-if="props.icon"
      :icon="props.icon"
      class="shrink-0"
      height="16"
    />
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import type {
  ButtonTone,
  ButtonVariant,
  ControlSize,
} from '../../lib/ui/control-types'
import Icon from './AppIcon.vue'

const props = defineProps<{
  type?: 'button' | 'submit' | 'reset'
  variant?: ButtonVariant
  size?: ControlSize
  icon?: string
  active?: boolean
  disabled?: boolean
  loading?: boolean
  square?: boolean
  tone?: ButtonTone
}>()

const buttonClass = computed(() => {
  const variant = props.variant ?? 'primary'
  const size = props.size
  return {
    'btn-neutral': variant === 'neutral',
    'btn-primary': variant === 'primary',
    'btn-ghost': variant === 'ghost' || variant === 'danger-ghost',
    'btn-danger-ghost': variant === 'danger-ghost',
    'btn-error': variant === 'danger',
    'btn-xs': size === 'xs',
    'btn-sm': size === 'sm',
    'btn-active': props.active,
    'btn-disabled': props.disabled || props.loading,
    'btn-square': props.square,
    'btn-muted': props.tone === 'muted',
    'btn-accent-soft': props.tone === 'accent',
  }
})

const buttonRef = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => buttonRef.value?.focus() })

const emit = defineEmits<{ (e: 'click', event: MouseEvent): void }>()

const onClick = (event: MouseEvent) => {
  if (!props.disabled && !props.loading) emit('click', event)
}
</script>

<style scoped>
.btn-error {
  background-color: var(--color-error);
  color: var(--color-error-content);
  border: 1px solid transparent;
}
.btn-error:hover {
  filter: brightness(0.9);
}
.btn-danger-ghost {
  color: var(--color-error);
}
.btn-danger-ghost:not(:disabled):hover {
  --btn-bg: color-mix(in oklab, var(--color-error) 12%, transparent);
}

.btn-ghost:not(.btn-danger-ghost) {
  color: var(--button-ghost-color, var(--color-base-content));
}
.btn-ghost.btn-muted:not(.btn-danger-ghost) {
  color: var(--app-text-muted);
}
.btn-ghost:not(.btn-danger-ghost):hover,
.btn-ghost:not(.btn-danger-ghost).btn-active {
  color: var(--color-base-content);
}
.btn-ghost.btn-accent-soft,
.btn-ghost.btn-accent-soft:hover,
.btn-ghost.btn-accent-soft.btn-active {
  color: var(--color-primary);
}
.btn-accent-soft:hover,
.btn-accent-soft.btn-active {
  --btn-bg: var(--app-accent-soft);
}
.btn-accent-soft.btn-active {
  box-shadow: inset 0 0 0 1px
    color-mix(in oklab, var(--color-primary) 25%, transparent);
}
.btn-ghost:disabled,
.btn-ghost.btn-muted:disabled,
.btn-ghost.btn-accent-soft:disabled,
.btn-ghost.btn-danger-ghost:disabled {
  color: var(--app-text-faint);
}
</style>
