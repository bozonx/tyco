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
        :info="t('voiceCommands.phrasesInfo')"
      >
        <FieldTextArea
          :model-value="command.phrases.join('\n')"
          @update:model-value="emit('update', { phrases: $event.split('\n') })"
        />
      </FieldRow>
      <InlineNotice
        v-if="voiceConflicts.length"
        kind="warning"
        :message="`${t('voiceCommands.conflicts')}: ${voiceConflicts.join(', ')}`"
      />
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { createBuiltInVoiceCommands } from '../../lib/voice-commands/built-in-voice-commands'
import {
  compileVoiceRoutes,
  findVoiceConflicts,
} from '../../lib/voice-commands/voice-resolver'
import { useDesktopStore } from '../../stores/desktop'
import { useToolsStore } from '../../stores/tools'
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
const voiceConflicts = computed(() =>
  findVoiceConflicts(voiceRoutes.value, props.command.id)
)
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
</style>
