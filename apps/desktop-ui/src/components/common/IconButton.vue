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
    ><AppIcon v-if="!loading" :icon="icon" size="md" aria-hidden="true"
  /></Button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import type { ButtonProps } from '../../lib/ui/control-types'
import AppIcon from './AppIcon.vue'
import Button from './Button.vue'

withDefaults(
  defineProps<
    Omit<ButtonProps, 'icon' | 'square'> & {
      label: string
      icon: string
      title?: string
    }
  >(),
  { size: 'sm', variant: 'ghost' }
)

const buttonRef = ref<InstanceType<typeof Button> | null>(null)
defineExpose({ focus: () => buttonRef.value?.focus() })
</script>
