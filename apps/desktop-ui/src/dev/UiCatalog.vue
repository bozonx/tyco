<template>
  <main class="ui-catalog">
    <h1>TyCo UI catalog</h1>
    <p>
      Development reference for shared controls, states, keyboard navigation and
      appearance.
    </p>
    <section class="catalog-options surface ui-form-container">
      <FieldRow group label="Theme"
        ><SegmentedControl v-model="theme" label="Theme" :options="themes"
      /></FieldRow>
      <FieldRow label="High contrast"
        ><FieldSwitch v-model="contrast"
      /></FieldRow>
      <FieldRow label="Reduced motion"
        ><FieldSwitch v-model="reducedMotion"
      /></FieldRow>
      <FieldRow label="Interface scale"
        ><FieldSelect
          v-model="scale"
          :options="[
            { id: 1, name: '100%' },
            { id: 1.25, name: '125%' },
            { id: 1.5, name: '150%' },
          ]"
      /></FieldRow>
    </section>
    <section
      class="surface catalog-section catalog-standard-controls ui-form-container"
    >
      <h2>Standard controls</h2>
      <div class="catalog-row">
        <Badge>Neutral</Badge><Badge tone="accent">Active</Badge
        ><Badge tone="success">Ready</Badge><Badge tone="warning">Warning</Badge
        ><Badge tone="error">Error</Badge>
        <Badge interactive @click="badgeClicks++"
          >Configure {{ badgeClicks }}</Badge
        >
      </div>
      <FieldRow label="Select this item"
        ><FieldCheckbox v-model="itemSelected"
      /></FieldRow>
      <FieldRow label="Enable this feature"
        ><FieldSwitch v-model="featureEnabled"
      /></FieldRow>
      <div class="catalog-row">
        <FieldInput
          size="xs"
          aria-label="Extra small input"
          model-value="Extra small"
        />
        <FieldInput size="sm" aria-label="Small input" model-value="Small" />
        <SearchInput size="sm" placeholder="Small search" />
        <FieldSelect
          size="sm"
          aria-label="Small select"
          model-value="one"
          :options="[{ id: 'one', name: 'One' }]"
        />
      </div>
      <div class="catalog-row">
        <ShortcutHint :keys="['Shift', 'Enter']">New line</ShortcutHint>
        <ShortcutHint :keys="['Enter']" interactive @click="hintClicks++"
          >Run {{ hintClicks }}</ShortcutHint
        >
        <ShortcutHint :keys="['Esc']" interactive disabled
          >Unavailable</ShortcutHint
        >
        <DragHandle />
        <InfoTooltip
          text="A text-only explanation"
          aria-label="Text explanation"
        />
        <InfoPopover aria-label="Interactive help"
          ><p>Copy an activation command</p>
          <Button size="sm" @click="helpClicks++"
            >Copy command {{ helpClicks }}</Button
          ></InfoPopover
        >
        <Button variant="neutral" size="sm">After help</Button>
      </div>
      <StateMessage density="compact" message="No configured models" />
    </section>
    <section class="surface catalog-section ui-form-container">
      <h2>Buttons</h2>
      <div class="catalog-row">
        <Button
          v-for="variant in variants"
          :key="variant"
          :variant="variant"
          size="sm"
          >{{ variant }}</Button
        >
        <Button size="sm" loading>Saving</Button>
        <Button size="xs">Extra small</Button><Button disabled>Disabled</Button>
        <IconButton label="Close" icon="mdi:close" />
        <Button variant="ghost" tone="muted">Muted action</Button>
        <Button variant="ghost" tone="accent" active>Active accent</Button>
        <ShortcutButton :keys="['Enter']" size="xs" disabled variant="primary"
          >Unavailable shortcut</ShortcutButton
        >
      </div>
    </section>
    <section class="surface catalog-section ui-form-container">
      <h2>Quick surfaces and long content</h2>
      <div class="catalog-quick-surface">
        <FieldInput
          aria-label="Quick input"
          model-value="Theme-aware quick input"
        />
      </div>
      <ShortcutButton :keys="['Enter']" variant="primary" size="sm"
        >A deliberately long action label that should remain readable at
        increased interface scale</ShortcutButton
      >
      <FieldRow
        label="A deliberately long translated field label spanning several words"
        ><FieldInput model-value="Long content"
      /></FieldRow>
    </section>
    <section class="surface catalog-section ui-form-container">
      <h2>Fields</h2>
      <FieldRow
        label="Text"
        hint="Hint linked to the control"
        info="Keyboard and screen reader accessible information"
        ><FieldInput v-model="text"
      /></FieldRow>
      <FieldRow label="Invalid field" error="Enter a value" required
        ><FieldInput model-value=""
      /></FieldRow>
      <FieldRow label="Disabled field" disabled
        ><FieldInput model-value="Unavailable"
      /></FieldRow>
      <FieldRow label="Number"
        ><FieldNumber v-model="number" min="0" max="10"
      /></FieldRow>
      <FieldRow label="Selection"
        ><FieldSelect
          v-model="selected"
          :options="[
            { id: 1, name: 'Numeric value', group: 'Numbers' },
            { id: 'text', name: 'String value', group: 'Strings' },
          ]"
      /></FieldRow>
      <FieldRow
        group
        label="Connection endpoints"
        hint="Both addresses are required"
        disabled
        required
      >
        <div class="flex flex-col gap-2 w-full">
          <FieldInput aria-label="Primary endpoint" model-value="primary" />
          <FieldInput aria-label="Secondary endpoint" model-value="secondary" />
        </div>
      </FieldRow>
      <FieldRow label="Multiline" vertical
        ><FieldTextArea v-model="text" auto-resize
      /></FieldRow>
      <FieldRow label="Search"
        ><SearchInput v-model="query" placeholder="Search components"
      /></FieldRow>
    </section>
    <section class="surface catalog-section ui-form-container">
      <h2>Navigation and disclosure</h2>
      <NavigationList
        v-model="navigation"
        label="Example navigation"
        :items="navigationItems"
      />
      <DisclosureHeader
        :expanded="detailsOpen"
        controls="catalog-details"
        title="Connection settings"
        description="A long provider description that can be truncated"
        icon="mdi:server-network"
        @toggle="detailsOpen = !detailsOpen"
      />
      <div v-if="detailsOpen" id="catalog-details">Connection details</div>
      <FieldRow
        label="Warnings"
        vertical
        density="compact"
        :warning="[
          'Inherited from plugin settings',
          'Check the selected value',
        ]"
      >
        <FieldInput model-value="Inherited value" />
      </FieldRow>
      <FieldRow
        label="Multiple errors"
        :error="['A value is required', 'The value must be unique']"
      >
        <FieldInput model-value="" />
      </FieldRow>
      <FieldRow
        label="Disabled compact field"
        vertical
        density="compact"
        disabled
        ><FieldInput model-value="Unavailable"
      /></FieldRow>
      <SearchInput
        v-model="catalogSearch"
        size="sm"
        quiet
        placeholder="Search example"
      />
      <InlineAction @click="detailsOpen = true"
        >Show connection details</InlineAction
      >
    </section>
    <section class="surface catalog-section ui-form-container">
      <h2>Navigation and menus</h2>
      <Tabs v-model="tab" label="Preview tabs" :tabs="tabs"
        ><template #panel="{ value }"
          ><p>Panel: {{ value }}</p></template
        ></Tabs
      >
      <div class="catalog-row">
        <SegmentedControl
          v-model="tab"
          label="Value selection"
          :options="tabs"
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
        <Button size="sm" @click="outerDialogOpen = true"
          >Open nested dialogs</Button
        >
        <Button size="sm" @click="contextMenuOpen = true"
          >Open editor menu</Button
        >
      </div>
    </section>
    <section class="surface catalog-section ui-form-container">
      <h2>States</h2>
      <InlineNotice message="Passive guidance" />
      <InlineNotice
        kind="success"
        announcement="polite"
        message="Connection verified"
      />
      <InlineNotice
        kind="error"
        announcement="assertive"
        message="Attachment needs attention"
        ><Button size="xs" variant="ghost"
          >Review attachment</Button
        ></InlineNotice
      >
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
    <section class="surface catalog-section ui-form-container">
      <h2>Previews and recording</h2>
      <div class="catalog-preview"><TextPreview :text="previewText" /></div>
      <div class="catalog-preview surface">
        <TextPreview appearance="plain" :text="previewText" />
      </div>
      <div class="catalog-preview surface">
        <Diff
          appearance="plain"
          old-text="Original text"
          new-text="Modified text"
          mode="unified"
        />
      </div>
      <div class="catalog-preview">
        <ParallelTextPreview
          :left-text="previewText"
          :right-text="previewText"
          :editable="false"
        />
      </div>
      <AudioWaveform layout="inline" :duration-ms="45000" />
      <AudioWaveform layout="inline" is-transcribing />
    </section>
    <ConfirmModal
      :open="dialogOpen"
      title="Delete item?"
      message="Verify focus starts on Cancel, stays inside the dialog and returns to the trigger."
      danger
      @cancel="dialogOpen = false"
      @confirm="dialogOpen = false"
    />
    <BaseDialog
      :open="outerDialogOpen"
      label="Outer dialog"
      @close="outerDialogOpen = false"
    >
      <Button autofocus @click="dialogOpen = true">Open confirmation</Button>
    </BaseDialog>
    <EditorContextMenu
      v-if="contextMenuOpen"
      :x="24"
      :y="24"
      :items="contextItems"
      @close="closeContextMenu"
    />
    <ToastContainer />
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch, watchEffect } from 'vue'

import Badge from '../components/common/Badge.vue'
import BaseDialog from '../components/common/BaseDialog.vue'
import Button from '../components/common/Button.vue'
import ConfirmModal from '../components/common/ConfirmModal.vue'
import Diff from '../components/common/Diff.vue'
import DisclosureHeader from '../components/common/DisclosureHeader.vue'
import DragHandle from '../components/common/DragHandle.vue'
import DropdownMenu from '../components/common/DropdownMenu.vue'
import FieldCheckbox from '../components/common/FieldCheckbox.vue'
import FieldInput from '../components/common/FieldInput.vue'
import FieldNumber from '../components/common/FieldNumber.vue'
import FieldRow from '../components/common/FieldRow.vue'
import FieldSelect from '../components/common/FieldSelect.vue'
import FieldSwitch from '../components/common/FieldSwitch.vue'
import FieldTextArea from '../components/common/FieldTextArea.vue'
import IconButton from '../components/common/IconButton.vue'
import InfoPopover from '../components/common/InfoPopover.vue'
import InfoTooltip from '../components/common/InfoTooltip.vue'
import InlineAction from '../components/common/InlineAction.vue'
import InlineNotice from '../components/common/InlineNotice.vue'
import NavigationList from '../components/common/NavigationList.vue'
import ParallelTextPreview from '../components/common/ParallelTextPreview.vue'
import SearchInput from '../components/common/SearchInput.vue'
import SegmentedControl from '../components/common/SegmentedControl.vue'
import ShortcutButton from '../components/common/ShortcutButton.vue'
import ShortcutHint from '../components/common/ShortcutHint.vue'
import StateMessage from '../components/common/StateMessage.vue'
import Tabs from '../components/common/Tabs.vue'
import TextPreview from '../components/common/TextPreview.vue'
import ToastContainer from '../components/common/ToastContainer.vue'
import EditorContextMenu from '../components/editor/EditorContextMenu.vue'
import AudioWaveform from '../components/voice/AudioWaveform.vue'
import { useToastStore } from '../stores/toast'

const themes = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'e-ink', name: 'E-ink' },
]
const variants = [
  'primary',
  'neutral',
  'ghost',
  'danger',
  'danger-ghost',
] as const
const tabs = [
  { id: 'source', name: 'Source' },
  { id: 'result', name: 'Result' },
]
const previewText = Array.from(
  { length: 20 },
  (_, index) => `Preview line ${index + 1}`
).join('\n')

const theme = ref('light')
const itemSelected = ref(false)
const featureEnabled = ref(false)
const badgeClicks = ref(0)
const hintClicks = ref(0)
const helpClicks = ref(0)
const contrast = ref(false)
const reducedMotion = ref(false)
const scale = ref<string | number | undefined>(1)
const text = ref('Example text')
const number = ref('3')
const selected = ref<string | number | undefined>(1)
const query = ref('')
const navigation = ref<string | number>('general')
const navigationItems = [
  { id: 'general', name: 'General', icon: 'mdi:tune-variant' },
  { id: 'plugins', name: 'Plugins', icon: 'mdi:puzzle-outline' },
  {
    id: 'plugin:example',
    name: 'Example plugin',
    icon: 'mdi:puzzle-outline',
    nested: true,
    status: 'Enabled',
    isEnabled: true,
  },
]
const detailsOpen = ref(false)
const catalogSearch = ref('')
const tab = ref<string | number>('source')
const dialogOpen = ref(false)
const outerDialogOpen = ref(false)
const contextMenuOpen = ref(false)
let contextTrigger: HTMLElement | null = null
watch(contextMenuOpen, (open) => {
  if (open) contextTrigger = document.activeElement as HTMLElement
})
function closeContextMenu(restoreFocus: boolean) {
  contextMenuOpen.value = false
  if (restoreFocus) contextTrigger?.focus()
}
const contextItems = [
  { id: 'first', label: 'First action', action: () => {} },
  { id: 'disabled', label: 'Unavailable action', disabled: true },
  {
    id: 'nested',
    label: 'Nested actions',
    children: [{ id: 'child', label: 'Child action', action: () => {} }],
  },
]
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
:global(body:has(.ui-catalog)) {
  overflow: auto;
}
.ui-catalog {
  min-height: 100dvh;
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
.catalog-quick-surface {
  padding: var(--space-sm);
  background: var(--app-quick-surface);
  backdrop-filter: var(--app-quick-backdrop);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-md);
}
.catalog-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-block: var(--space-lg);
}

.catalog-preview {
  height: 12rem;
  min-height: 0;
  overflow: hidden;
}
</style>
