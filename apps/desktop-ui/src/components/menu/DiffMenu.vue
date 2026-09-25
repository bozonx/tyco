<template>
  <ActionOverlayLayout :title="t('menu.compareResult')">
    <template #preview>
      <Diff :oldText="props.oldText" :newText="props.newText" />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.newText"
        :sourceText="props.oldText"
        :leftLetterKeys="leftLetterKeys"
        :spaceKey="spaceKey"
        :toEditorVisible="true"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useIpcStore } from '../../stores/ipc'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Diff from '../common/Diff.vue'

const props = defineProps<{ oldText: string; newText: string }>()

const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const { t } = useI18n()
const defaultActions = computed(() => actionMenuStore.getDefaultActions())

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() => {
  return actionMenuStore.getShortcutActions()
})

const spaceKey = computed(() =>
  ipcStore.params?.windowId ? defaultActions.value[0] : undefined
)
</script>
