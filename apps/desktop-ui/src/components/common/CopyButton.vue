<template>
  <IconButton
    :size="size"
    :variant="variant"
    :tone="tone"
    :label="isCopied() ? (copiedLabel ?? t('common.copied')) : label"
    :icon="isCopied() ? 'mdi:check' : 'mdi:content-copy'"
    @click="copy(value)"
  />
</template>

<script setup lang="ts">
import { useCopyValue } from '../../composables/use-copy-value'
import { useI18n } from '../../composables/use-i18n'
import type {
  ButtonTone,
  ButtonVariant,
  ControlSize,
} from '../../lib/ui/control-types'
import IconButton from './IconButton.vue'

defineProps<{
  value: string
  label: string
  copiedLabel?: string
  size?: ControlSize
  variant?: ButtonVariant
  tone?: ButtonTone
}>()

const { t } = useI18n()
const { copy, isCopied } = useCopyValue()
</script>
