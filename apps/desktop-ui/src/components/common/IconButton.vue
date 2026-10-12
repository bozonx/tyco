<template>
  <Button
    :size="size"
    :variant="variant"
    :aria-label="label"
    :title="label"
    square
    ><Icon :icon="icon" height="16" :aria-hidden="true"
  /></Button>
</template>

<script setup lang="ts">
import Button from './Button.vue'
import { Icon } from '@iconify/vue'

withDefaults(
  defineProps<{
    label: string
    icon: string
    size?: 'xs' | 'sm'
    variant?: 'primary' | 'neutral' | 'ghost' | 'danger'
  }>(),
  { size: 'sm', variant: 'ghost' }
)
</script>
