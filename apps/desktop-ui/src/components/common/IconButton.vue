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
    ><Icon v-if="!loading" :icon="icon" height="16" aria-hidden="true"
  /></Button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import type { ButtonProps } from '../../lib/ui/control-types'
import Icon from './AppIcon.vue'
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
