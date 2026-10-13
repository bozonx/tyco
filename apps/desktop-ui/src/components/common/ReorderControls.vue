<template>
  <div class="flex items-center shrink-0">
    <IconButton
      icon="mdi:arrow-up"
      size="xs"
      :label="t('common.moveUp', { name })"
      :aria-disabled="!canMoveUp"
      :class="{ 'opacity-40': !canMoveUp }"
      @click="canMoveUp && emit('move', -1)"
    />
    <IconButton
      icon="mdi:arrow-down"
      size="xs"
      :label="t('common.moveDown', { name })"
      :aria-disabled="!canMoveDown"
      :class="{ 'opacity-40': !canMoveDown }"
      @click="canMoveDown && emit('move', 1)"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import IconButton from './IconButton.vue'

defineProps<{ name: string; canMoveUp: boolean; canMoveDown: boolean }>()
const emit = defineEmits<{ move: [offset: number] }>()
const { t } = useI18n()
</script>
