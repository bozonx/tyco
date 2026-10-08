export type FastNoteSaveMode = 'create' | 'append'

export type FastNoteFolderPreset =
  'flat' | 'year' | 'year_month' | 'year_month_flat' | 'year_week' | 'custom'

export type FastNotePreset =
  | 'default'
  | 'obsidian_zettel'
  | 'obsidian_daily'
  | 'date_folders'
  | 'logseq_journal'
  | 'custom'

export interface FastNoteConfig {
  pathToNotes: string
  preset?: FastNotePreset
  saveMode?: FastNoteSaveMode
  folderPreset?: FastNoteFolderPreset
  customSubfolderTemplate?: string
  fileNameTemplate?: string
  contentTemplate?: string
  clearInputAfterSave?: boolean
}

export interface PresetDefaults {
  saveMode: FastNoteSaveMode
  folderPreset: FastNoteFolderPreset
  customSubfolderTemplate: string
  fileNameTemplate: string
  contentTemplate: string
}

export const FAST_NOTE_PRESETS: Record<FastNotePreset, PresetDefaults> = {
  default: {
    saveMode: 'create',
    folderPreset: 'flat',
    customSubfolderTemplate: '',
    fileNameTemplate: '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md',
    contentTemplate: '{content}',
  },
  obsidian_zettel: {
    saveMode: 'create',
    folderPreset: 'flat',
    customSubfolderTemplate: '',
    fileNameTemplate: '{zettel} {title}.md',
    contentTemplate:
      '---\ndate: {YYYY}-{MM}-{DD} {HH}:{mm}\ntags:\n  - quick-note\n---\n\n# {title}\n\n{content}',
  },
  obsidian_daily: {
    saveMode: 'append',
    folderPreset: 'flat',
    customSubfolderTemplate: '',
    fileNameTemplate: '{YYYY}-{MM}-{DD}.md',
    contentTemplate: '- **{HH}:{mm}**: {content}',
  },
  date_folders: {
    saveMode: 'create',
    folderPreset: 'year_month',
    customSubfolderTemplate: '',
    fileNameTemplate: '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss} - {title}.md',
    contentTemplate: '{content}',
  },
  logseq_journal: {
    saveMode: 'append',
    folderPreset: 'custom',
    customSubfolderTemplate: 'journals',
    fileNameTemplate: '{YYYY}_{MM}_{DD}.md',
    contentTemplate: '- {content}',
  },
  custom: {
    saveMode: 'create',
    folderPreset: 'flat',
    customSubfolderTemplate: '',
    fileNameTemplate: '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md',
    contentTemplate: '{content}',
  },
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Returns the ISO-8601 week number (1-53) for the given date. */
export function getIsoWeekNumber(date: Date): number {
  const target = new Date(date.valueOf())
  const dayNr = (date.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setMonth(0, 1)
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7))
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
}

export function getDateTokens(date: Date) {
  const YYYY = String(date.getFullYear())
  const YY = YYYY.slice(-2)
  const MM = pad(date.getMonth() + 1)
  const DD = pad(date.getDate())
  const HH = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  const WW = pad(getIsoWeekNumber(date))
  const zettel = `${YYYY}${MM}${DD}${HH}${mm}`
  const timestamp = String(Math.floor(date.getTime() / 1000))

  return { YYYY, YY, MM, DD, HH, mm, ss, WW, zettel, timestamp }
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|\0]+/g, '-').trim()
}

export function extractTitle(text: string, maxLength = 60): string {
  const firstLine =
    text.split(/\r?\n/).find((line) => line.trim().length > 0) || ''
  const cleaned = firstLine
    .replace(/^([#\s*-]+(\[[ xX]\])?|>+|\d+\.)\s*/, '')
    .trim()
  const sanitized = sanitizeFileName(cleaned)
  if (!sanitized) {
    return ''
  }
  return sanitized.length > maxLength
    ? sanitized.slice(0, maxLength).trim()
    : sanitized
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

export function renderTemplate(
  template: string,
  tokens: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return Object.hasOwn(tokens, key) ? tokens[key] : match
  })
}

export function getEffectiveConfig(
  config?: Partial<FastNoteConfig>
): PresetDefaults {
  const presetKey = config?.preset || 'default'
  const presetDefaults =
    FAST_NOTE_PRESETS[presetKey] || FAST_NOTE_PRESETS.default

  return {
    saveMode: config?.saveMode || presetDefaults.saveMode,
    folderPreset: config?.folderPreset || presetDefaults.folderPreset,
    customSubfolderTemplate:
      config?.customSubfolderTemplate ?? presetDefaults.customSubfolderTemplate,
    fileNameTemplate:
      config?.fileNameTemplate || presetDefaults.fileNameTemplate,
    contentTemplate: config?.contentTemplate ?? presetDefaults.contentTemplate,
  }
}

export function resolveNoteDir(
  baseDir: string,
  folderPreset: FastNoteFolderPreset,
  customSubfolderTemplate: string,
  date: Date
): string {
  const trimmedBase = baseDir.trim().replace(/[/\\]+$/, '')
  const tokens = getDateTokens(date)

  let subfolder: string
  switch (folderPreset) {
    case 'year':
      subfolder = tokens.YYYY
      break
    case 'year_month':
      subfolder = `${tokens.YYYY}/${tokens.MM}`
      break
    case 'year_month_flat':
      subfolder = `${tokens.YYYY}-${tokens.MM}`
      break
    case 'year_week':
      subfolder = `${tokens.YYYY}/W${tokens.WW}`
      break
    case 'custom':
      subfolder = renderTemplate(customSubfolderTemplate || '', tokens)
      break
    case 'flat':
    default:
      subfolder = ''
      break
  }

  const cleanSubfolder = subfolder.replace(/^[/\\]+|[/\\]+$/g, '')
  return cleanSubfolder ? `${trimmedBase}/${cleanSubfolder}` : trimmedBase
}

export function resolveNoteFileName(
  fileNameTemplate: string,
  date: Date,
  text: string
): string {
  const dateTokens = getDateTokens(date)
  const title = extractTitle(text)
  const slug = slugify(title)

  const tokens = {
    ...dateTokens,
    title: title || `${dateTokens.YYYY}-${dateTokens.MM}-${dateTokens.DD}`,
    slug: slug || `${dateTokens.YYYY}-${dateTokens.MM}-${dateTokens.DD}`,
  }

  const rawName = renderTemplate(
    fileNameTemplate || '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md',
    tokens
  )
  let cleaned = sanitizeFileName(rawName)

  if (!cleaned.includes('.')) {
    cleaned = `${cleaned}.md`
  }

  if (!cleaned || cleaned === '.md') {
    return `${dateTokens.YYYY}-${dateTokens.MM}-${dateTokens.DD}_${dateTokens.HH}-${dateTokens.mm}-${dateTokens.ss}.md`
  }

  return cleaned
}

export function resolveNoteContent(
  mode: FastNoteSaveMode,
  contentTemplate: string,
  text: string,
  date: Date
): string {
  const dateTokens = getDateTokens(date)
  const title = extractTitle(text)

  const tokens = { ...dateTokens, title, content: text }

  let result: string
  if (contentTemplate?.trim()) {
    result = renderTemplate(contentTemplate, tokens)
  } else if (mode === 'append') {
    result = `- **${dateTokens.HH}:${dateTokens.mm}**: ${text}`
  } else {
    result = text
  }

  return result.endsWith('\n') ? result : `${result}\n`
}
