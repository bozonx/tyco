<template>
  <div class="overlay">
    <div
      v-if="navBarVisible"
      class="navbar bg-neutral text-neutral-content shadow-sm overlay-header"
    >
      <Button neutral @click="menuModalsStore.back">
        {{ t('common.back') }}{{ t('nav.escSuffix') }}
      </Button>
    </div>
    <ContentPadding class="flex-1">
      <slot />
    </ContentPadding>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { useMenuModalsStore } from '../../stores/menuModals'

const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()
withDefaults(
  defineProps<{
    navBarVisible?: boolean
  }>(),
  {
    navBarVisible: true,
  }
)
</script>

<style scoped>
.overlay {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  z-index: var(--z-overlay);
  position: fixed;
  inset: 0;
  background-color: var(--app-overlay-bg);
  backdrop-filter: blur(4px);
}

.overlay-header {
  padding: var(--space-sm) var(--space-xl);
}
</style>
