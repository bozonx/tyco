<template>
  <button
    :class="['btn', buttonClass]"
    :type="props.type ?? 'button'"
    :disabled="props.disabled"
    @click="onClick"
  >
    <Icon v-if="props.icon" :icon="props.icon" class="shrink-0" height="16" />
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import Icon from './AppIcon.vue'

const props = defineProps<{
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'neutral' | 'ghost' | 'danger'
  size?: 'sm' | 'xs'
  icon?: string
  active?: boolean
  disabled?: boolean
  square?: boolean
}>()

const buttonClass = computed(() => {
  const variant = props.variant ?? 'primary'
  const size = props.size
  return {
    'btn-neutral': variant === 'neutral',
    'btn-primary': variant === 'primary',
    'btn-ghost': variant === 'ghost',
    'btn-error': variant === 'danger',
    'btn-xs': size === 'xs',
    'btn-sm': size === 'sm',
    'btn-active': props.active,
    'btn-disabled': props.disabled,
    'btn-square': props.square,
  }
})

const emit = defineEmits<{ (e: 'click', event: MouseEvent): void }>()

const onClick = (event: MouseEvent) => {
  emit('click', event)
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
</style>
