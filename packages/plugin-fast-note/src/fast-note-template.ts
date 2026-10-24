const MS_PER_SECOND = 1000
const MS_PER_WEEK = 7 * 24 * 60 * 60 * MS_PER_SECOND

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

export const FAST_NOTE_PRESETS: Record<
  FastNotePreset,
  Partial<PresetDefaults>
> = {
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
  custom: {},
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Returns the ISO-8601 week number (1-53) for the given date. */
export function getIsoWeekNumber(date: Date): number {
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  )
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setUTCMonth(0, 1)
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7))
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / MS_PER_WEEK)
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
  const weekDate = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  )
  weekDate.setUTCDate(
    weekDate.getUTCDate() + 3 - ((weekDate.getUTCDay() + 6) % 7)
  )
  const GGGG = String(weekDate.getUTCFullYear())
  const zettel = `${YYYY}${MM}${DD}${HH}${mm}${ss}${String(date.getMilliseconds()).padStart(3, '0')}`
  const timestamp = String(Math.floor(date.getTime() / MS_PER_SECOND))

  return { YYYY, YY, MM, DD, HH, mm, ss, WW, GGGG, zettel, timestamp }
}

export function sanitizeFileName(name: string): string {
  let cleaned = name
    .replace(/[/\\:*?"<>|\p{Cc}]+/gu, '-')
    .trim()
    .replace(/[. ]+$/g, '')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned))
    cleaned = `_${cleaned}`
  return cleaned
}

export function extractTitle(text: string, maxLength = Infinity): string {
  const firstLine =
    text.split(/\r?\n/).find((line) => line.trim().length > 0) || ''
  const cleaned = firstLine
    .replace(/^([#\s*-]+(\[[ xX]\])?|>+|\d+\.)\s*/, '')
    .trim()
  if (!cleaned) {
    return ''
  }
  return Array.from(cleaned).length > maxLength
    ? Array.from(cleaned).slice(0, maxLength).join('').trim()
    : cleaned
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
  const presetDefaults = {
    ...FAST_NOTE_PRESETS.default,
    ...FAST_NOTE_PRESETS[presetKey],
  } as PresetDefaults

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
  const base = baseDir.trim()
  const trimmedBase = /^[a-zA-Z]:[/\\]+$/.test(base)
    ? `${base.slice(0, 2)}/`
    : base.replace(/[/\\]+$/, '') || (baseDir.trim().startsWith('/') ? '/' : '')
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
      subfolder = `${tokens.GGGG}/W${tokens.WW}`
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
  return cleanSubfolder
    ? `${trimmedBase}${trimmedBase.endsWith('/') ? '' : '/'}${cleanSubfolder}`
    : trimmedBase
}

export function resolveNoteFileName(
  fileNameTemplate: string,
  date: Date,
  text: string
): string {
  const dateTokens = getDateTokens(date)
  const title = sanitizeFileName(extractTitle(text, 60))
  const slug = slugify(title)

  const tokens = {
    ...dateTokens,
    title: title || `${dateTokens.YYYY}-${dateTokens.MM}-${dateTokens.DD}`,
    slug: slug || `${dateTokens.YYYY}-${dateTokens.MM}-${dateTokens.DD}`,
  }

  const template = fileNameTemplate || '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md'
  const rawName = renderTemplate(template, tokens)
  let cleaned = sanitizeFileName(rawName)

  if (!/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(template)) {
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

  // Indent continuation lines when the template inserts content into a list.
  const contentLine = contentTemplate
    .split('\n')
    .find((line) => line.includes('{content}'))
  const listPrefix = contentLine?.match(/^(\s*(?:[-+*]|\d+[.)])\s+)/)?.[1]
  const source =
    /(?:^|\n)#+ \{title\}/.test(contentTemplate) && /^\s*#+\s/.test(text)
      ? text.replace(/^\s*#+[^\n]*(?:\r?\n|$)/, '').replace(/^\r?\n/, '')
      : text
  const content = listPrefix
    ? source.replace(/\r?\n/g, `\n${' '.repeat(listPrefix.length)}`)
    : source
  const tokens = { ...dateTokens, title, content }

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

export type FastNoteValidationIssue =
  | 'noNotesPath'
  | 'invalidNotesPath'
  | 'invalidSubfolder'
  | 'unknownTemplateToken'
  | 'missingContentToken'
  | 'invalidFileName'

/** Validates templates before writing or clearing any editor content. */
export function validateFastNoteConfig(
  config: Partial<FastNoteConfig>
): FastNoteValidationIssue[] {
  const issues: FastNoteValidationIssue[] = []
  const path = config.pathToNotes?.trim() ?? ''
  if (!path) issues.push('noNotesPath')
  else if (
    !/^(?:\/|[a-zA-Z]:[/\\]|\\\\|~(?:[/\\]|$))/.test(path) ||
    /\p{Cc}/u.test(path) ||
    path.split(/[/\\]/).includes('..')
  )
    issues.push('invalidNotesPath')
  const effective = getEffectiveConfig(config)
  const dateKeys = Object.keys(getDateTokens(new Date()))
  const templates: Array<[string, string[]]> = [
    [effective.fileNameTemplate, [...dateKeys, 'title', 'slug']],
    [effective.contentTemplate, [...dateKeys, 'title', 'content']],
  ]
  if (effective.folderPreset === 'custom') {
    const folder = effective.customSubfolderTemplate
    templates.push([folder, dateKeys])
    if (
      /^(?:[/\\]|[a-zA-Z]:)/.test(folder) ||
      folder.split(/[/\\]/).includes('..') ||
      /[:*?"<>|\p{Cc}]/u.test(folder)
    )
      issues.push('invalidSubfolder')
  }
  if (
    templates.some(([template, keys]) =>
      Array.from(template.matchAll(/\{([A-Za-z]\w*)\}/g)).some(
        (match) => !keys.includes(match[1])
      )
    )
  )
    issues.push('unknownTemplateToken')
  if (
    effective.contentTemplate.trim() &&
    !effective.contentTemplate.includes('{content}')
  )
    issues.push('missingContentToken')
  if (/\p{Cc}/u.test(effective.fileNameTemplate)) issues.push('invalidFileName')
  return issues
}
