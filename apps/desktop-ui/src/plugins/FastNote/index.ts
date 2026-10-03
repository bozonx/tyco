import type { InputConfigItem } from '@/types'
import type { PluginContext } from '@/types/plugins'
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

export default function pluginIndex() {
  return {
    name: 'FastNote',
    labelKey: 'plugin.fastNote.label',
    defaultConfig: {
      fields: [
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
            {
              id: 'obsidian_daily',
              labelKey: 'plugin.fastNote.presetObsidianDaily',
            },
            {
              id: 'date_folders',
              labelKey: 'plugin.fastNote.presetDateFolders',
            },
            {
              id: 'logseq_journal',
              labelKey: 'plugin.fastNote.presetLogseqJournal',
            },
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
      ],
    },
    init: (ctx: PluginContext) => {
      const executeSaveNote = async (
        input?: string,
        overrides?: Partial<FastNoteConfig>
      ) => {
        const text = (
          input ??
          (ctx.getEditorInputSelectedText() || ctx.getEditorInputValue())
        ).trim()

        if (!text) {
          ctx.toast('toast.textNotSelected', 'error')
          return
        }

        const cfg = ctx.getMyConfig<FastNoteConfig>()
        const baseDir = cfg?.pathToNotes?.trim()

        if (!baseDir) {
          ctx.toast('toast.noNotesPath', 'warn')
          return
        }

        const mergedConfig = { ...cfg, ...overrides }
        const effective = getEffectiveConfig(mergedConfig)
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

        const apiFunctionName =
          effective.saveMode === 'append' ? 'appendNote' : 'saveNote'
        const result = await ctx.callApiFunction(apiFunctionName, [
          dir,
          fileName,
          content,
        ])

        if (result.success) {
          ctx.toast(
            effective.saveMode === 'append'
              ? 'toast.noteAppended'
              : 'toast.noteSaved',
            'success'
          )
          if (cfg?.clearInputAfterSave) {
            ctx.setEditorInputValue('')
          }
        } else {
          console.error('Failed to save the note', result.error)
          ctx.toast('toast.noteSaveFailed', 'error')
        }
      }

      ctx.registerActionsItems([
        {
          id: 'fastNote',
          preferredKey: 'c',
          labelKey: 'plugin.fastNote.label',
          icon: 'mdi:note-plus-outline',
          action: (input?: string) => executeSaveNote(input),
        },
        {
          id: 'fastNoteAppendDaily',
          preferredKey: 'd',
          labelKey: 'plugin.fastNote.actionAppendDaily',
          icon: 'mdi:calendar-plus',
          action: (input?: string) =>
            executeSaveNote(input, {
              saveMode: 'append',
              fileNameTemplate: '{YYYY}-{MM}-{DD}.md',
              contentTemplate: '- **{HH}:{mm}**: {content}',
            }),
        },
      ])

      ctx.registerToolbarItems([
        {
          id: 'fastNote',
          icon: 'mdi:note-plus-outline',
          tooltipKey: 'plugin.fastNote.label',
          position: 'right',
          action: () => executeSaveNote(),
        },
      ])
    },
  }
}
