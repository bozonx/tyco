<template>
  <IconButton
    class="overlay-close-button action-overlay-close"
    icon="mdi:close"
    :label="t('common.close')"
    :title="resolvedTitle"
    @click="emit('click')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import IconButton from '../common/IconButton.vue'

const props = defineProps<{ title?: string; hasBack?: boolean }>()

const emit = defineEmits<{ (e: 'click'): void }>()
const { t } = useI18n()

const resolvedTitle = computed(() => {
  if (props.title) return props.title
  return props.hasBack
    ? t('common.closeAllHint')
    : t('common.closeOrEscapeHint')
})
</script>

<style scoped>
.overlay-close-button {
  flex-shrink: 0;
}
</style>
