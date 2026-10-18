<template>
  <section class="command-group">
    <h4 class="command-group-title">{{ t('voiceCommands.title') }}</h4>
    <FieldSwitch
      :model-value="command.isVoiceEnabled"
      :label="t('voiceCommands.enabled')"
      @update:model-value="emit('update', { isVoiceEnabled: $event })"
    />
    <template v-if="command.isVoiceEnabled">
      <FieldRow
        class="command-field"
        vertical
        density="compact"
        :label="t('voiceCommands.phrases')"
      >
        <FieldTextArea
          :model-value="command.phrases.join('\n')"
          @update:model-value="emit('update', { phrases: $event.split('\n') })"
        />
      </FieldRow>
      <p v-for="phrase in voicePhrases" :key="phrase" class="command-hint">
        {{ phrase }}
      </p>
      <InlineNotice
        v-if="voiceConflicts.length"
        kind="warning"
        :message="`${t('voiceCommands.conflicts')}: ${voiceConflicts.join(', ')}`"
      />
      <FieldRow
        class="command-field"
        vertical
        density="compact"
        :label="t('voiceCommands.try')"
      >
        <FieldInput v-model="voiceTrial" />
      </FieldRow>
      <p v-if="voiceTrial" class="command-hint">{{ voiceTrialResult }}</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { commandLabel } from '../../lib/commands/command-runtime'
import { createBuiltInVoiceCommands } from '../../lib/voice-commands/built-in-voice-commands'
import {
  compileVoiceRoutes,
  findVoiceConflicts,
  resolveVoice,
} from '../../lib/voice-commands/voice-resolver'
import { useDesktopStore } from '../../stores/desktop'
import { useToolsStore } from '../../stores/tools'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InlineNotice from '../common/InlineNotice.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

const props = defineProps<{ command: CommandConfig; userConfig?: UserConfig }>()
const emit = defineEmits<{ update: [patch: Partial<CommandConfig>] }>()
const { t } = useI18n()
const desktopStore = useDesktopStore()
const toolsStore = useToolsStore()
const voiceTrial = ref('')
const voiceRoutes = computed(() =>
  compileVoiceRoutes(
    [
      ...createBuiltInVoiceCommands(toolsStore, t),
      ...(
        props.userConfig?.commands ??
        desktopStore.userConfig.commands ??
        []
      ).filter((item) => item.id !== props.command.id),
      props.command,
    ],
    toolsStore
  )
)
const voicePhrases = computed(() => [
  ...new Set(
    voiceRoutes.value
      .filter((route) => route.commandId === props.command.id)
      .map((route) =>
        [
          route.phrase,
          ...route.parameters.map((parameter) =>
            parameter.variants.join(' / ')
          ),
        ].join(' ')
      )
  ),
])
const voiceConflicts = computed(() =>
  findVoiceConflicts(voiceRoutes.value, props.command.id)
)
const voiceTrialResult = computed(() => {
  const result = resolveVoice(voiceRoutes.value, voiceTrial.value)
  if (result.kind === 'parameter-error')
    return t('voiceCommands.parameterError')
  if (result.kind === 'incomplete') return t('voiceCommands.incomplete')
  if (result.kind === 'none') return t('voiceCommands.none')
  const candidates = result.candidates
    .map((candidate) => {
      const command = (
        props.userConfig?.commands ?? desktopStore.userConfig.commands
      ).find((item) => item.id === candidate.commandId)
      const builtIn = createBuiltInVoiceCommands(toolsStore, t).find(
        (item) => item.id === candidate.commandId
      )
      const label = command
        ? commandLabel(command)
        : builtIn
          ? commandLabel(builtIn)
          : candidate.commandId
      const parameters = Object.values(candidate.parameters).join(', ')
      return `${label}${parameters ? ` (${parameters})` : ''}: ${candidate.text}`
    })
    .join(' / ')
  return result.kind === 'ambiguous'
    ? `${t('voiceCommands.choose')}: ${candidates}`
    : candidates
})
</script>
<style scoped>
.command-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--app-border-subtle);
}
.command-group-title {
  margin: 0;
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--app-text-muted);
}
.command-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
