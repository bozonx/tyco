<template>
  <Button
    ref="buttonRef"
    :type="type"
    :size="size"
    :variant="variant"
    :tone="tone"
    :disabled="disabled"
    :loading="loading"
    :active="active"
    :aria-label="label"
    :title="title ?? label"
    square
    ><span
      v-if="!loading"
      ref="iconRef"
      class="icon-button-symbol"
      aria-hidden="true"
    >
      <AppIcon :icon="icon" size="md" /> </span
  ></Button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useFeedbackMotion } from '../../composables/use-feedback-motion'
import type { ButtonProps } from '../../lib/ui/control-types'
import AppIcon from './AppIcon.vue'
import Button from './Button.vue'

const props = withDefaults(
  defineProps<
    Omit<ButtonProps, 'icon' | 'square'> & {
      label: string
      icon: string
      title?: string
    }
  >(),
  { size: 'sm', variant: 'ghost' }
)

const iconRef = ref<HTMLElement | null>(null)
useFeedbackMotion(
  () => iconRef.value,
  () => props.icon,
  { distancePx: 0, durationMs: 120 }
)

const buttonRef = ref<InstanceType<typeof Button> | null>(null)
defineExpose({ focus: () => buttonRef.value?.focus() })
</script>

<style scoped>
.icon-button-symbol {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
