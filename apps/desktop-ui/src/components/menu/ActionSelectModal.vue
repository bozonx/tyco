<template>
  <ActionOverlayLayout :title="t('settings.selectAction')" esc-mode="back">
    <template #preview>
      <div class="flex flex-col gap-2 p-3 overflow-y-auto h-full">
        <Button
          v-for="action in actions"
          :key="action.id"
          variant="neutral"
          class="justify-start text-left w-full"
          @click="selectAction(action.id)"
        >
          {{ action.name }}
        </Button>
      </div>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ActionSelectMenuParams } from '../../lib/modals/menu-modal-params'
import { useActionMenuStore } from '../../stores/action-menu'
import { useMenuModalsStore } from '../../stores/menu-modals'
import Button from '../common/Button.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'

const { t } = useI18n()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()

const props = defineProps<ActionSelectMenuParams>()
const actions = computed(() => {
  return actionMenuStore
    .getDefaultActions()
    .map((action) => ({
      id: action.id || '',
      name: action.labelKey ? t(action.labelKey) : action.name || '',
    }))
    .filter((a) => a.id)
})

function selectAction(id: string) {
  props.onSelect(id)
  menuModalsStore.back()
}
</script>
