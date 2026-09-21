import type { InputConfigItem } from '@/types'
import type { PluginContext } from '@/types/plugins'

interface FastNoteConfig {
  pathToNotes: string
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Builds a sortable, filesystem-safe file name from the local time. */
export const buildNoteFileName = (date: Date): string => {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`

  return `${day}_${time}.md`
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
      ],
    },
    init: (ctx: PluginContext) => {
      const saveNote = async () => {
        const text = (
          ctx.getEditorInputSelectedText() || ctx.getEditorInputValue()
        ).trim()

        if (!text) {
          ctx.toast('toast.textNotSelected', 'error')
          return
        }

        const dir = ctx.getMyConfig<FastNoteConfig>()?.pathToNotes?.trim()

        if (!dir) {
          ctx.toast('toast.noNotesPath', 'warn')
          return
        }

        const result = await ctx.callApiFunction('saveNote', [
          dir,
          buildNoteFileName(new Date()),
          `${text}\n`,
        ])

        if (result.success) {
          ctx.toast('toast.noteSaved', 'success')
        } else {
          console.error('Failed to save the note', result.error)
          ctx.toast('toast.noteSaveFailed', 'error')
        }
      }

      ctx.registerToolbarItems([
        {
          id: 'fastNote',
          icon: 'mdi:note-plus-outline',
          tooltipKey: 'plugin.fastNote.label',
          position: 'right',
          action: saveNote,
        },
      ])
    },
  }
}
