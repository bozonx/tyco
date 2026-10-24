<template>
  <Button
    v-for="item in items"
    :key="item.id"
    size="sm"
    :square="isToolbarItemSquare(labelOf(item))"
    variant="ghost"
    :disabled="isToolbarItemDisabled(item, editorInputStore.hasSelection)"
    :title="scoped(tooltipOf(item))"
    :aria-label="scoped(tooltipOf(item))"
    :aria-busy="item.isRunning || undefined"
    @click="item.action"
  >
    <AppIcon v-if="item.icon" :icon="item.icon" size="lg" />
    <span v-if="labelOf(item)" class="text-sm font-medium leading-none">{{
      labelOf(item)
    }}</span>
  </Button>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import {
  getToolbarLabel,
  getToolbarTooltip,
  isToolbarItemDisabled,
  isToolbarItemSquare,
  scopedActionLabel,
} from '../../lib/editor/editor-toolbar-item'
import { useEditorInputStore } from '../../stores/editor-input'
import type { ToolbarItem } from '../../types/plugins'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'

/** The plugin items of one toolbar column */
defineProps<{ items: ToolbarItem[] }>()

const editorInputStore = useEditorInputStore()
const { t } = useI18n()

const scoped = (label: string) =>
  scopedActionLabel(label, editorInputStore.hasSelection, t)
const tooltipOf = (item: ToolbarItem) => getToolbarTooltip(item, t)
const labelOf = (item: ToolbarItem) => getToolbarLabel(item, t)
</script>
