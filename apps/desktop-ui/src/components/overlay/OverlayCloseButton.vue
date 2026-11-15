<template>
  <IconButton
    class="overlay-close-button action-overlay-close"
    icon="mdi:close"
    :label="t('common.close')"
    :title="title ?? t('common.closeAllHint')"
    @click="emit('click')"
  />
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import IconButton from '../common/IconButton.vue'

defineProps<{ title?: string }>()

const emit = defineEmits<{ (e: 'click'): void }>()
const { t } = useI18n()
</script>

<style scoped>
.overlay-close-button {
  flex-shrink: 0;
}
</style>
