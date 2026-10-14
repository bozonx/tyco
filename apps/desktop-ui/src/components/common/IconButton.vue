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
import type { ButtonVariant, ControlSize } from '../../lib/ui/control-types'
import Icon from './AppIcon.vue'
import Button from './Button.vue'

withDefaults(
  defineProps<{
    label: string
    icon: string
    size?: ControlSize
    variant?: ButtonVariant
  }>(),
  { size: 'sm', variant: 'ghost' }
)
</script>
