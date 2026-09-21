<template>
  <button
    :class="['btn', buttonClass, props.class]"
    :disabled="props.disabled"
    @click="onClick"
  >
    <Icon v-if="props.icon" :icon="props.icon" class="shrink-0" height="16" />
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { Icon } from '@iconify/vue'

const props = defineProps<{
  class?: string
  icon?: string
  sm?: boolean
  xs?: boolean
  neutral?: boolean
  active?: boolean
  disabled?: boolean
  square?: boolean
  ghost?: boolean
}>()

const buttonClass = computed(() => {
  return {
    'btn-neutral': props.neutral && !props.ghost,
    'btn-primary': !props.neutral && !props.ghost,
    'btn-xs': props.xs,
    'btn-sm': props.sm,
    'btn-active': props.active,
    'btn-disabled': props.disabled,
    'btn-square': props.square,
    'btn-ghost': props.ghost,
  }
})

const emit = defineEmits<{ (e: 'click'): void }>()

const onClick = () => {
  emit('click')
}
</script>
