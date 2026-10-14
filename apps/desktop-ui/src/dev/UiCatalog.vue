<template>
  <main class="ui-catalog">
    <h1>TyCo UI catalog</h1>
    <p>
      Development reference for shared controls, states, keyboard navigation and
      appearance.
    </p>
    <section class="catalog-options surface">
      <FieldRow label="Theme"
        ><SegmentedControl
          v-model:value="theme"
          label="Theme"
          :options="themes"
      /></FieldRow>
      <FieldRow label="High contrast"
        ><FieldCheckbox v-model:value="contrast"
      /></FieldRow>
      <FieldRow label="Reduced motion"
        ><FieldCheckbox v-model:value="reducedMotion"
      /></FieldRow>
      <FieldRow label="Interface scale"
        ><FieldSelect
          v-model:value="scale"
          :options="[
            { id: 1, name: '100%' },
            { id: 1.25, name: '125%' },
            { id: 1.5, name: '150%' },
          ]"
      /></FieldRow>
    </section>
    <section class="surface catalog-section">
      <h2>Buttons</h2>
      <div class="catalog-row">
        <Button
          v-for="variant in variants"
          :key="variant"
          :variant="variant"
          size="sm"
          >{{ variant }}</Button
        >
        <Button size="xs">Extra small</Button><Button disabled>Disabled</Button>
        <IconButton label="Close" icon="mdi:close" />
      </div>
    </section>
    <section class="surface catalog-section">
      <h2>Fields</h2>
      <FieldRow
        label="Text"
        hint="Hint linked to the control"
        info="Keyboard and screen reader accessible information"
        ><FieldInput v-model:value="text"
      /></FieldRow>
      <FieldRow label="Invalid field" error="Enter a value" required
        ><FieldInput value=""
      /></FieldRow>
      <FieldRow label="Disabled field" disabled
        ><FieldInput value="Unavailable"
      /></FieldRow>
      <FieldRow label="Number"
        ><FieldNumber v-model:value="number" min="0" max="10"
      /></FieldRow>
      <FieldRow label="Selection"
        ><FieldSelect
          v-model:value="selected"
          :options="[
            { id: 1, name: 'Numeric value', group: 'Numbers' },
            { id: 'text', name: 'String value', group: 'Strings' },
          ]"
      /></FieldRow>
      <FieldRow label="Multiline" vertical
        ><FieldTextArea v-model:value="text" auto-resize
      /></FieldRow>
      <FieldRow label="Search"
        ><SearchInput v-model:value="query" placeholder="Search components"
      /></FieldRow>
    </section>
    <section class="surface catalog-section">
      <h2>Navigation and menus</h2>
      <Tabs v-model:value="tab" label="Preview tabs" :tabs="tabs"
        ><template #panel="{ value }"
          ><p>Panel: {{ value }}</p></template
        ></Tabs
      >
      <div class="catalog-row">
        <SegmentedControl
          v-model:value="tab"
          label="Value selection"
          :options="tabs.map((item) => ({ id: item.key, name: item.text }))"
        />
        <DropdownMenu
          label="Actions"
          :items="[
            { label: 'Show notification', action: notify },
            {
              label: 'Confirm deletion',
              danger: true,
              action: () => {
                dialogOpen = true
              },
            },
          ]"
        />
        <Button size="sm" @click="dialogOpen = true">Open dialog</Button>
      </div>
    </section>
    <section class="surface catalog-section">
      <h2>States</h2>
      <StateMessage
        title="No items"
        message="Add an item to get started."
        icon="mdi:history"
      />
      <StateMessage
        kind="loading"
        message="Loading items…"
        icon="mdi:progress-clock"
        inline
      />
      <StateMessage
        kind="error"
        message="Could not load items."
        icon="mdi:alert-circle-outline"
        inline
        ><Button size="xs" variant="ghost">Retry</Button></StateMessage
      >
    </section>
    <ConfirmModal
      :open="dialogOpen"
      title="Delete item?"
      message="Verify focus starts on Cancel, stays inside the dialog and returns to the trigger."
      danger
      @cancel="dialogOpen = false"
      @confirm="dialogOpen = false"
    />
    <ToastContainer />
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watchEffect } from 'vue'

import Button from '../components/common/Button.vue'
import ConfirmModal from '../components/common/ConfirmModal.vue'
import DropdownMenu from '../components/common/DropdownMenu.vue'
import FieldCheckbox from '../components/common/FieldCheckbox.vue'
import FieldInput from '../components/common/FieldInput.vue'
import FieldNumber from '../components/common/FieldNumber.vue'
import FieldRow from '../components/common/FieldRow.vue'
import FieldSelect from '../components/common/FieldSelect.vue'
import FieldTextArea from '../components/common/FieldTextArea.vue'
import IconButton from '../components/common/IconButton.vue'
import SearchInput from '../components/common/SearchInput.vue'
import SegmentedControl from '../components/common/SegmentedControl.vue'
import StateMessage from '../components/common/StateMessage.vue'
import Tabs from '../components/common/Tabs.vue'
import ToastContainer from '../components/common/ToastContainer.vue'
import { useToastStore } from '../stores/toast'

const themes = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'e-ink', name: 'E-ink' },
]
const variants = ['primary', 'neutral', 'ghost', 'danger'] as const
const tabs = [
  { key: 'source', text: 'Source' },
  { key: 'result', text: 'Result' },
]
const theme = ref('light')
const contrast = ref(false)
const reducedMotion = ref(false)
const scale = ref<string | number | undefined>(1)
const text = ref('Example text')
const number = ref('3')
const selected = ref<string | number | undefined>(1)
const query = ref('')
const tab = ref<string | number>('source')
const dialogOpen = ref(false)
const toastStore = useToastStore()
function notify() {
  toastStore.addToast('Example notification', 'info', { durationMs: 5000 })
}
const html = document.documentElement
const previous = {
  theme: html.dataset.theme,
  contrast: html.dataset.contrast,
  motion: html.dataset.motion,
  scale: html.style.getPropertyValue('--ui-scale'),
}
watchEffect(() => {
  html.dataset.theme = theme.value
  html.dataset.contrast = contrast.value ? 'more' : 'normal'
  html.dataset.motion = reducedMotion.value ? 'reduce' : 'normal'
  html.style.setProperty('--ui-scale', String(scale.value))
})
onBeforeUnmount(() => {
  for (const key of ['theme', 'contrast', 'motion'] as const) {
    if (previous[key] === undefined) delete html.dataset[key]
    else html.dataset[key] = previous[key]
  }
  if (previous.scale) html.style.setProperty('--ui-scale', previous.scale)
  else html.style.removeProperty('--ui-scale')
})
</script>

<style scoped>
.ui-catalog {
  height: 100dvh;
  overflow: auto;
  padding: var(--space-2xl);
  background: var(--app-surface);
}
.catalog-section,
.catalog-options {
  margin-block: var(--space-lg);
}
.catalog-section {
  padding: var(--space-lg);
}
.catalog-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-block: var(--space-lg);
}
</style>
