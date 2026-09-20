<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1 class="menu-title">{{ t('menu.reviewResult') }}</h1>
    <div class="flex-1 relative">
      <TextPreview :text="props.text" class="absolute" />
    </div>

    <ShortcutList 
      :text="props.text"
      :leftLetterKeys="leftLetterKeys"
      :spaceKey="spaceKey"
      :toEditorVisible="true" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { ActionItem, useActionMenuStore } from '../../stores/actionMenu';
import { useIpcStore } from '../../stores/ipc';

const props = defineProps<{
  text: string
}>()

const actionMenuStore = useActionMenuStore();
const ipcStore = useIpcStore();
const { t } = useI18n()
const defaultActions = computed(() => actionMenuStore.getDefaultActions())

const leftLetterKeys = computed(() =>
  [
    ipcStore.params?.windowId ? defaultActions.value[0] : undefined,
    defaultActions.value[1],
  ].filter(Boolean) as ActionItem[]
)

const spaceKey = computed(() =>
  ipcStore.params?.windowId ? defaultActions.value[0] : undefined
);
</script>
