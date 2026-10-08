import type { PluginDefinition } from '@tyco/plugin-sdk'
import { locales } from './locales.js'
import type { InputConfigItem } from '@tyco/plugin-sdk'

import { runToolFromToolbar } from '@tyco/plugin-sdk'
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
} from './fast-note-template.js'

/** Builds a sortable, filesystem-safe file name from the local time. */
export const buildNoteFileName = (date: Date): string => {
  return resolveNoteFileName('{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md', date, '')
}

const FIELDS: InputConfigItem[] = [
  {
    type: 'text',
    name: 'pathToNotes',
    labelKey: 'local.pathToNotes',
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
    defaultValue: '',
  },
  {
    type: 'text',
    name: 'fileNameTemplate',
    labelKey: 'local.fileNameTemplate',
    defaultValue: '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md',
  },
  {
    type: 'textarea',
    name: 'contentTemplate',
    labelKey: 'local.contentTemplate',
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

/** The settings of the former daily item of the menu */
const APPEND_DAILY: Partial<FastNoteConfig> = {
  saveMode: 'append',
  fileNameTemplate: '{YYYY}-{MM}-{DD}.md',
  contentTemplate: '- **{HH}:{mm}**: {content}',
}

export default function pluginIndex(): PluginDefinition {
  return {
    id: 'FastNote',
    version: '0.1.0',
    apiVersion: 2,
    capabilities: ['editor', 'notes'],
    defaultLocale: 'en_US',
    locales,
    labelKey: 'local.label',
    descriptionKey: 'local.description',
    defaultConfig: { fields: FIELDS },
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
        defaultCommands: [
          {
            id: 'note',
            nameKey: 'local.label',
            phrasesKey: 'local.notePhrases',
            menu: { preferredKey: 'c' },
          },
          {
            id: 'daily',
            nameKey: 'local.actionAppendDaily',
            phrasesKey: 'local.dailyPhrases',
            toolConfig: { ...APPEND_DAILY },
            menu: {
              preferredKey: 'd',
            },
          },
        ],
        run: async ({ input, config, source }): Promise<ToolResult> => {
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
          const fromEditor = source === 'menu' || source === 'toolbar'
          if (
            fromEditor &&
            ctx.getMyConfig<FastNoteConfig>()?.clearInputAfterSave
          ) {
            ctx.setEditorInputValue('')
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
          action: () => runToolFromToolbar(ctx, write),
        },
      ])
    },
  }
}
