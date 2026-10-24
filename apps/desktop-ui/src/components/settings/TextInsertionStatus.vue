<template>
  <div v-if="injection.ok === false" class="insertion-status">
    <InlineNotice
      kind="warning"
      icon="mdi:alert-outline"
      :message="
        t('settings.textInjection.unavailable', { error: injection.error })
      "
    />
    <Button
      size="sm"
      variant="ghost"
      icon="mdi:refresh"
      @click="hotkeysStore.checkTextInjection()"
    >
      {{ t('settings.textInjection.recheck') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useGlobalHotkeysStore } from '../../stores/global-hotkeys'
import Button from '../common/Button.vue'
import InlineNotice from '../common/InlineNotice.vue'

const { t } = useI18n()
const hotkeysStore = useGlobalHotkeysStore()
const { injection } = hotkeysStore

onMounted(() => {
  void hotkeysStore.checkTextInjection()
})
</script>

<style scoped>
.insertion-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
}
</style>
