import type { PluginDefinition } from '@tyco/plugin-sdk'
import { locales } from './locales.js'
import type { InputConfigItem } from '@tyco/plugin-sdk'

import {
  type PluginContext,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
  type ToolResult,
} from '@tyco/plugin-sdk'
import {
  type FastNoteConfig,
  getEffectiveConfig,
  resolveNoteContent,
  resolveNoteDir,
  resolveNoteFileName,
  FAST_NOTE_PRESETS,
  validateFastNoteConfig,
} from './fast-note-template.js'

const FIELDS: InputConfigItem[] = [
  {
    type: 'text',
    name: 'pathToNotes',
    labelKey: 'local.pathToNotes',
    infoKey: 'local.pathToNotesInfo',
    defaultValue: '',
  },
  {
    type: 'select',
    name: 'preset',
    labelKey: 'local.preset',
    defaultValue: 'default',
    options: [
      { id: 'default', labelKey: 'local.presetDefault' },
      { id: 'obsidian_zettel', labelKey: 'local.presetObsidianZettel' },
      { id: 'obsidian_daily', labelKey: 'local.presetObsidianDaily' },
      { id: 'date_folders', labelKey: 'local.presetDateFolders' },
      { id: 'logseq_journal', labelKey: 'local.presetLogseqJournal' },
      { id: 'custom', labelKey: 'local.presetCustom' },
    ],
  },
  {
    type: 'select',
    name: 'saveMode',
    labelKey: 'local.saveMode',
    defaultValue: 'create',
    options: [
      { id: 'create', labelKey: 'local.saveModeCreate' },
      { id: 'append', labelKey: 'local.saveModeAppend' },
    ],
  },
  {
    type: 'select',
    name: 'folderPreset',
    labelKey: 'local.folderPreset',
    defaultValue: 'flat',
    options: [
      { id: 'flat', labelKey: 'local.folderFlat' },
      { id: 'year', labelKey: 'local.folderYear' },
      { id: 'year_month', labelKey: 'local.folderYearMonth' },
      { id: 'year_month_flat', labelKey: 'local.folderYearMonthFlat' },
      { id: 'year_week', labelKey: 'local.folderYearWeek' },
      { id: 'custom', labelKey: 'local.folderCustom' },
    ],
  },
  {
    type: 'text',
    name: 'customSubfolderTemplate',
    labelKey: 'local.customSubfolderTemplate',
    infoKey: 'local.customSubfolderTemplateInfo',
    defaultValue: '',
  },
  {
    type: 'text',
    name: 'fileNameTemplate',
    labelKey: 'local.fileNameTemplate',
    infoKey: 'local.fileNameTemplateInfo',
    defaultValue: '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md',
  },
  {
    type: 'textarea',
    name: 'contentTemplate',
    labelKey: 'local.contentTemplate',
    infoKey: 'local.contentTemplateInfo',
    defaultValue: '{content}',
  },
  {
    type: 'checkbox',
    name: 'clearInputAfterSave',
    labelKey: 'local.clearInputAfterSave',
    defaultValue: false,
  },
]

/**
 * What a command may set for itself; clearing the editor stays a setting of the
 * plugin, since only the menu and the toolbar have an editor
 */
const COMMAND_FIELDS = FIELDS.filter(
  (field) => field.name !== 'clearInputAfterSave'
)

export default function pluginIndex(): PluginDefinition {
  return {
    id: 'FastNote',
    version: '0.1.0',
    apiVersion: 2,
    capabilities: ['editor', 'notes'],
    notesDirectoryField: 'pathToNotes',
    defaultLocale: 'en-US',
    locales,
    labelKey: 'local.label',
    descriptionKey: 'local.description',
    defaultConfig: { fields: FIELDS, presets: { preset: FAST_NOTE_PRESETS } },
    init: (ctx: PluginContext) => {
      const write: ToolDefinition = {
        id: 'write',
        labelKey: 'local.toolLabel',
        descriptionKey: 'local.toolDescription',
        icon: 'mdi:note-plus-outline',
        description:
          'Saves the text as a new note, or appends it to a note, in the notes folder of the user',
        inputSchema: TEXT_INPUT_SCHEMA,
        configFields: COMMAND_FIELDS,
        run: async ({
          input,
          config,
          source,
          signal,
          editorSnapshot,
        }): Promise<ToolResult> => {
          const text = String(input.text ?? '').trim()
          if (!text)
            return {
              ok: false,
              level: 'warn',
              messageKey: 'toast.textNotSelected',
            }

          const settings = config as Partial<FastNoteConfig>
          const baseDir = settings.pathToNotes?.trim()
          if (!baseDir) {
            return { ok: false, level: 'warn', messageKey: 'local.noNotesPath' }
          }

          const issues = validateFastNoteConfig(settings)
          if (issues.length)
            return {
              ok: false,
              level: 'warn',
              messageKey: `local.${issues[0]}`,
            }

          const fromEditor = source === 'menu' || source === 'toolbar'
          const canClearEditor =
            fromEditor && ctx.getMyConfig<FastNoteConfig>()?.clearInputAfterSave
          const snapshot = canClearEditor
            ? (editorSnapshot ?? (await ctx.getEditorInputSnapshot()))
            : undefined
          const sourceMatches =
            snapshot &&
            (snapshot.selectedText.trim() || snapshot.value.trim()) === text
          if (signal.aborted) return { ok: false, cancelled: true }

          const effective = getEffectiveConfig(settings)
          const now = new Date()
          const dir = resolveNoteDir(
            baseDir,
            effective.folderPreset,
            effective.customSubfolderTemplate,
            now
          )
          const fileName = resolveNoteFileName(
            effective.fileNameTemplate,
            now,
            text
          )
          const content = resolveNoteContent(
            effective.saveMode,
            effective.contentTemplate,
            text,
            now
          )

          const result = await ctx.callApiFunction(
            effective.saveMode === 'append' ? 'appendNote' : 'saveNote',
            [dir, fileName, content]
          )
          if (!result.success) {
            ctx.log('error', 'Failed to save the note', result.error)
            return { ok: false, messageKey: 'local.noteSaveFailed' }
          }

          // the overlay and external calls have no editor to clear or keep
          if (snapshot && sourceMatches && !signal.aborted) {
            // Saving a selection must preserve the surrounding document.
            await ctx.applyEditorInputEdit(
              snapshot,
              '',
              snapshot.selectedText.trim() ? 'selection' : 'document'
            )
          }
          return {
            ok: true,
            messageKey:
              effective.saveMode === 'append'
                ? 'local.noteAppended'
                : 'local.noteSaved',
            keepWindow: fromEditor,
          }
        },
      }

      ctx.registerTools([write])

      ctx.registerToolbarItems([
        {
          id: 'fastNote',
          icon: 'mdi:note-plus-outline',
          tooltipKey: 'local.label',
          position: 'right',
          toolId: write.id,
        },
      ])
    },
  }
}
