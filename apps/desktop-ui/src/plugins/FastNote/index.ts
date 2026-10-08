import type { InputConfigItem } from '@/types'

import { clientLogger } from '../../lib/logger'
import { runToolFromToolbar } from '../../lib/plugins/toolbar-tool'
import {
  type PluginContext,
  TEXT_INPUT_SCHEMA,
  type ToolDefinition,
  type ToolResult,
} from '../../types/plugins'
import {
  type FastNoteConfig,
  getEffectiveConfig,
  resolveNoteContent,
  resolveNoteDir,
  resolveNoteFileName,
} from './fast-note-template'

/** Builds a sortable, filesystem-safe file name from the local time. */
export const buildNoteFileName = (date: Date): string => {
  return resolveNoteFileName('{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md', date, '')
}

const FIELDS: InputConfigItem[] = [
  {
    type: 'text',
    name: 'pathToNotes',
    labelKey: 'plugin.fastNote.pathToNotes',
    defaultValue: '',
  } as InputConfigItem,
  {
    type: 'select',
    name: 'preset',
    labelKey: 'plugin.fastNote.preset',
    defaultValue: 'default',
    options: [
      { id: 'default', labelKey: 'plugin.fastNote.presetDefault' },
      {
        id: 'obsidian_zettel',
        labelKey: 'plugin.fastNote.presetObsidianZettel',
      },
      { id: 'obsidian_daily', labelKey: 'plugin.fastNote.presetObsidianDaily' },
      { id: 'date_folders', labelKey: 'plugin.fastNote.presetDateFolders' },
      { id: 'logseq_journal', labelKey: 'plugin.fastNote.presetLogseqJournal' },
      { id: 'custom', labelKey: 'plugin.fastNote.presetCustom' },
    ],
  } as InputConfigItem,
  {
    type: 'select',
    name: 'saveMode',
    labelKey: 'plugin.fastNote.saveMode',
    defaultValue: 'create',
    options: [
      { id: 'create', labelKey: 'plugin.fastNote.saveModeCreate' },
      { id: 'append', labelKey: 'plugin.fastNote.saveModeAppend' },
    ],
  } as InputConfigItem,
  {
    type: 'select',
    name: 'folderPreset',
    labelKey: 'plugin.fastNote.folderPreset',
    defaultValue: 'flat',
    options: [
      { id: 'flat', labelKey: 'plugin.fastNote.folderFlat' },
      { id: 'year', labelKey: 'plugin.fastNote.folderYear' },
      { id: 'year_month', labelKey: 'plugin.fastNote.folderYearMonth' },
      {
        id: 'year_month_flat',
        labelKey: 'plugin.fastNote.folderYearMonthFlat',
      },
      { id: 'year_week', labelKey: 'plugin.fastNote.folderYearWeek' },
      { id: 'custom', labelKey: 'plugin.fastNote.folderCustom' },
    ],
  } as InputConfigItem,
  {
    type: 'text',
    name: 'customSubfolderTemplate',
    labelKey: 'plugin.fastNote.customSubfolderTemplate',
    defaultValue: '',
  } as InputConfigItem,
  {
    type: 'text',
    name: 'fileNameTemplate',
    labelKey: 'plugin.fastNote.fileNameTemplate',
    defaultValue: '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md',
  } as InputConfigItem,
  {
    type: 'textarea',
    name: 'contentTemplate',
    labelKey: 'plugin.fastNote.contentTemplate',
    defaultValue: '{content}',
  } as InputConfigItem,
  {
    type: 'checkbox',
    name: 'clearInputAfterSave',
    labelKey: 'plugin.fastNote.clearInputAfterSave',
    defaultValue: false,
  } as InputConfigItem,
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

export default function pluginIndex() {
  return {
    name: 'FastNote',
    labelKey: 'plugin.fastNote.label',
    descriptionKey: 'plugin.fastNote.description',
    defaultConfig: { fields: FIELDS },
    init: (ctx: PluginContext) => {
      const write: ToolDefinition = {
        id: 'write',
        labelKey: 'plugin.fastNote.toolLabel',
        descriptionKey: 'plugin.fastNote.toolDescription',
        icon: 'mdi:note-plus-outline',
        description:
          'Saves the text as a new note, or appends it to a note, in the notes folder of the user',
        inputSchema: TEXT_INPUT_SCHEMA,
        configFields: COMMAND_FIELDS,
        defaultCommands: ({ t }) => [
          {
            id: 'note',
            name: t('plugin.fastNote.label'),
            phrases: t('plugin.fastNote.notePhrases').split('\n'),
            menu: { replaces: 'FastNote:fastNote', preferredKey: 'c' },
          },
          {
            id: 'daily',
            name: t('plugin.fastNote.actionAppendDaily'),
            phrases: t('plugin.fastNote.dailyPhrases').split('\n'),
            toolConfig: { ...APPEND_DAILY },
            menu: {
              replaces: 'FastNote:fastNoteAppendDaily',
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
            return { ok: false, level: 'warn', messageKey: 'toast.noNotesPath' }
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
            console.error('Failed to save the note', result.error)
            clientLogger.error(
              'Failed to save the note',
              result.error,
              'fast-note'
            )
            return { ok: false, messageKey: 'toast.noteSaveFailed' }
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
                ? 'toast.noteAppended'
                : 'toast.noteSaved',
            keepWindow: fromEditor,
          }
        },
      }

      ctx.registerTools([write])

      ctx.registerToolbarItems([
        {
          id: 'fastNote',
          icon: 'mdi:note-plus-outline',
          tooltipKey: 'plugin.fastNote.label',
          position: 'right',
          action: () => runToolFromToolbar(ctx, write),
        },
      ])
    },
  }
}
