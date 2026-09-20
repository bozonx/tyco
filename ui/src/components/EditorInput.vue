<template>
  <div ref="hostRef" class="main-input textarea" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { createEditorState } from '../lib/editor/createEditorState'
import {
  applyStoreSelection,
  applyStoreValue,
  selectAll,
  setPlaceholder,
} from '../lib/editor/editorSync'
import { useEditorInputStore } from '../stores/editorInput'
import { useMenuModalsStore } from '../stores/menuModals'
import { useRouteParams } from '../stores/routeParams'
import { EditorView } from '@codemirror/view'

const editorInputStore = useEditorInputStore()
const routeParamsStore = useRouteParams()
const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()

const hostRef = ref<HTMLElement | null>(null)

let view: EditorView | null = null

onMounted(() => {
  if (routeParamsStore.params.text) {
    editorInputStore.setValue(routeParamsStore.params.text)
  }

  if (!hostRef.value) return

  view = new EditorView({
    parent: hostRef.value,
    state: createEditorState({
      doc: editorInputStore.value,
      placeholder: t('input.textPlaceholder'),
      onDocChange: (value) => editorInputStore.setValue(value),
      onSelectionChange: (text, start, end) =>
        editorInputStore.setSelection(text, start, end),
    }),
  })

  editorInputStore.focus()
})

onUnmounted(() => {
  view?.destroy()
  view = null
})

// значение стора -> редактор (свои же правки отсекаются сравнением с документом)
watch(
  () => editorInputStore.value,
  (value) => {
    if (view) applyStoreValue(view, value)
  }
)

// выделение стора -> редактор
watch(
  () => [editorInputStore.selectionStart, editorInputStore.selectionEnd],
  ([start, end]) => {
    if (view) applyStoreSelection(view, start, end)
  }
)

// смена языка
watch(
  () => t('input.textPlaceholder'),
  (text) => {
    if (view) setPlaceholder(view, text)
  }
)

// set focus on close modal
watch(
  () => menuModalsStore.anyModalOpen,
  (value) => {
    if (!value) editorInputStore.focus()
  }
)

// handle focus
watch(
  () => editorInputStore.focusCount,
  (newValue, oldValue) => {
    if (newValue > oldValue) view?.focus()
  }
)

// handle select all
watch(
  () => editorInputStore.selectAllCount,
  (newValue, oldValue) => {
    if (newValue > oldValue && view) {
      selectAll(view)
      view.focus()
    }
  }
)
</script>

<style scoped>
.main-input {
  display: flex;
  height: 100%;
  padding: 0;
  overflow: hidden;
}

.main-input:focus-within {
  border-color: oklch(var(--p));
  box-shadow: 0 0 0 2px oklch(var(--p) / 0.15);
  outline: none;
}

.main-input :deep(.cm-editor) {
  flex: 1;
  min-width: 0;
  height: 100%;
  background-color: transparent;
  color: inherit;
}

.main-input :deep(.cm-editor.cm-focused) {
  outline: none;
}

.main-input :deep(.cm-scroller) {
  overflow: auto;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.5;
}

.main-input :deep(.cm-content) {
  padding: 0.5rem 0.75rem;
  caret-color: currentColor;
}

.main-input :deep(.cm-line) {
  padding: 0;
}

.main-input :deep(.cm-placeholder) {
  color: var(--app-text-faint);
}
</style>
