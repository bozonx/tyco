<template>
  <div class="command-editor">
    <label class="command-field">
      <span class="command-field-label">{{ t('commands.nameLabel') }}</span>
      <FieldInput
        :value="command.name"
        :placeholder="t('commands.namePlaceholder')"
        @update:value="update({ name: $event })"
      />
    </label>

    <div class="command-field">
      <span class="command-field-label">
        {{ t('commands.idLabel') }}
        <InfoTooltip :text="t('commands.idInfo')" />
      </span>
      <div class="command-field-row">
        <code class="command-id" :title="command.id">{{ command.id }}</code>
        <Button
          type="button"
          ghost
          square
          sm
          :title="copied ? t('commands.idCopied') : t('commands.copyId')"
          @click="copyId"
        >
          <Icon
            :icon="copied ? 'mdi:check' : 'mdi:content-copy'"
            width="16"
            height="16"
          />
        </Button>
      </div>
    </div>

    <div class="command-field-row">
      <FieldCheckbox
        :value="command.enabled"
        :label="t('commands.enabled')"
        @update:value="update({ enabled: $event })"
      />
    </div>

    <div v-if="knownTool" class="command-field-row">
      <FieldCheckbox
        :value="takesText"
        :label="t('commands.takesText')"
        @update:value="updateToolConfig('takesText', $event)"
      />
      <InfoTooltip :text="t('commands.takesTextInfo')" />
    </div>

    <CustomActionFields
      v-if="knownTool"
      :key="command.id"
      :command="command"
      @update="updateToolConfig"
    />
    <p v-else class="command-warning">
      {{ t('commands.unknownTool', { tool: command.toolId }) }}
    </p>

    <div class="command-field">
      <span class="command-field-label">
        {{ t('settings.actionAfterRunLabel') }}
        <InfoTooltip :text="t('settings.actionAfterRunInfo')" />
      </span>
      <SegmentedControl
        :value="command.afterRun"
        :label="t('settings.actionAfterRunLabel')"
        :options="[
          { id: 'none', name: t('settings.actionAfterRunNone') },
          { id: 'showMenu', name: t('settings.actionAfterRunShowMenu') },
        ]"
        @update:value="update({ afterRun: $event as CustomActionAfterRun })"
      />
    </div>

    <div class="command-field-row">
      <FieldCheckbox
        :value="command.logOutput"
        :label="t('settings.actionLogOutput')"
        @update:value="update({ logOutput: $event })"
      />
      <InfoTooltip :text="t('settings.actionLogOutputInfo')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  commandTakesText,
  isKnownTool,
} from '../../lib/commands/command-config'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import CustomActionFields from './CustomActionFields.vue'
import { Icon } from '@iconify/vue'
import type { CommandConfig, CustomActionAfterRun } from '@tyco/shared'

const props = defineProps<{ command: CommandConfig }>()

const emit = defineEmits<{ (event: 'update', command: CommandConfig): void }>()

const { t } = useI18n()

const knownTool = computed(() => isKnownTool(props.command))
const takesText = computed(() => commandTakesText(props.command))

function update(patch: Partial<CommandConfig>) {
  emit('update', { ...props.command, ...patch })
}

function updateToolConfig(field: string, value: unknown) {
  update({ toolConfig: { ...props.command.toolConfig, [field]: value } })
}

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyId() {
  try {
    await navigator.clipboard.writeText(props.command.id)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // clipboard access might be denied; the id stays selectable
  }
}

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.command-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
  width: 100%;
}

.command-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 0.25rem);
}

.command-field-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--app-text-muted);
}

.command-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
  width: 100%;
}

.command-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: var(--app-text-muted);
  user-select: all;
}

.command-warning {
  font-size: 0.75rem;
  color: var(--color-warning);
}
</style>
