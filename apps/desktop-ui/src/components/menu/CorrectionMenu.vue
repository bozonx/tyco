<template>
<div class="flex flex-col gap-4 w-full h-full"> 
  <h1>{{ t('menu.reviewCorrectionResult') }}</h1>

  <div class="flex-1">
    <DiffInput :oldText="props.oldText" :newText="props.newText" @update:newText="handleNewText" />
  </div>

  <ShortcutList
    :text="props.newText"
    :spaceKey="spaceKey"
    :toEditorVisible="true" />
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useIpcStore } from '../../stores/ipc';
import { useActionMenuStore } from '../../stores/actionMenu';

const ipcStore = useIpcStore();
const actionMenuStore = useActionMenuStore();
const { t } = useI18n()
const defaultActions = computed(() => actionMenuStore.getDefaultActions())

const props = defineProps<{
  newText: string
  oldText: string
}>()

const emit = defineEmits<{
  (e: 'update:text', value: string): void;
}>();

function handleNewText(newText: string) {
  emit('update:text', newText);
}

const spaceKey = computed(() =>
  ipcStore.params?.windowId ? defaultActions.value[0] : undefined
);
</script>
