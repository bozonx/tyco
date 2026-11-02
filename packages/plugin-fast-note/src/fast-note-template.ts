const MS_PER_SECOND = 1000
const MS_PER_WEEK = 7 * 24 * 60 * 60 * MS_PER_SECOND
/** How many characters of the first line `{title}` takes into a file name. */
const MAX_TITLE_LENGTH = 60
/**
 * Common file systems allow 255 bytes per name; the rest is left for the
 * numeric suffix the host adds on a name collision.
 */
const MAX_FILE_NAME_BYTES = 200
const DEFAULT_FILE_NAME_TEMPLATE = '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md'

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

const SAVE_MODES: readonly FastNoteSaveMode[] = ['create', 'append']
const FOLDER_PRESETS: readonly FastNoteFolderPreset[] = [
  'flat',
  'year',
  'year_month',
  'year_month_flat',
  'year_week',
  'custom',
]

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

/**
 * Values a preset fills in. `custom` is empty: choosing it keeps the current
 * values, and editing a value of another preset switches to it.
 */
export const FAST_NOTE_PRESETS: Record<
  FastNotePreset,
  Partial<PresetDefaults>
> = {
  default: {
    saveMode: 'create',
    folderPreset: 'flat',
    customSubfolderTemplate: '',
    fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE,
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

const DATE_TOKEN_NAMES = Object.keys(getDateTokens(new Date(0)))

/** Line endings of pasted or Windows text, as the templates write them. */
const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, '\n')

/** Invisible characters that reorder how a name reads, e.g. `abc‮dm.exe`. */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/gu
/** Device names Windows opens instead of a file, with any extension. */
const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?: *\.| *$)/i

export function sanitizeFileName(name: string): string {
  let cleaned = name
    .replace(BIDI_CONTROLS, '')
    .replace(/[/\\:*?"<>|\p{Cc}]+/gu, '-')
    .trim()
    // a leading dot hides the file; Windows drops trailing dots and spaces
    .replace(/^[. ]+|[. ]+$/g, '')
  if (WINDOWS_RESERVED_NAME.test(cleaned)) cleaned = `_${cleaned}`
  return cleaned
}

const graphemes = (text: string): string[] =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    (part) => part.segment
  )

/** Cuts `text` to at most `maxBytes` of UTF-8 without splitting a character. */
function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= maxBytes) return text
  let result = ''
  let bytes = 0
  for (const part of graphemes(text)) {
    bytes += encoder.encode(part).length
    if (bytes > maxBytes) break
    result += part
  }
  return result
}

/** Block markup in front of the text of a line, in any nesting order. */
const BLOCK_MARKER =
  /^(?:>[ \t]*|#{1,6}(?:[ \t]+|$)|[-*+](?:[ \t]+|$)|\d+[.)](?:[ \t]+|$)|\[[ xX]\](?:[ \t]+|$))/

/** The first non-empty line without its Markdown markup. */
export function extractTitle(text: string, maxLength = Infinity): string {
  const firstLine =
    normalizeLineEndings(text)
      .split('\n')
      .find((line) => line.trim().length > 0) ?? ''
  let line = firstLine.trim()
  while (BLOCK_MARKER.test(line)) line = line.replace(BLOCK_MARKER, '')
  const cleaned = line
    .replace(
      /!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g,
      (_, target: string, alias?: string) => alias || target
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')
    .trim()
  const parts = graphemes(cleaned)
  return parts.length > maxLength
    ? parts.slice(0, maxLength).join('').trim()
    : cleaned
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/** `{name}` is a token; `{{` and `}}` write a literal brace. */
const TEMPLATE_TOKEN = /\{\{|\}\}|\{([A-Za-z]\w*)\}/g

/** The token names a template uses, without escaped braces. */
function templateTokenNames(template: string): string[] {
  return Array.from(
    template.matchAll(TEMPLATE_TOKEN),
    (match) => match[1]
  ).filter((name): name is string => name !== undefined)
}

/**
 * Replaces the known tokens of `template`. `format` may escape a value; it is
 * told whether the token stands inside quotes of the template.
 */
export function renderTemplate(
  template: string,
  tokens: Record<string, string>,
  format?: (name: string, value: string, quote: '"' | "'" | '') => string
): string {
  return template.replace(TEMPLATE_TOKEN, (match, name, offset: number) => {
    if (match === '{{') return '{'
    if (match === '}}') return '}'
    if (!Object.hasOwn(tokens, name)) return match
    const before = template[offset - 1]
    const quote =
      (before === '"' || before === "'") &&
      template[offset + match.length] === before
        ? before
        : ''
    return format ? format(name, tokens[name]!, quote) : tokens[name]!
  })
}

const nonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * The settings a note is written with: a value left empty or unknown falls back
 * to the selected preset, then to the default one.
 */
export function getEffectiveConfig(
  config?: Partial<FastNoteConfig>
): PresetDefaults {
  const presetKey =
    config?.preset && Object.hasOwn(FAST_NOTE_PRESETS, config.preset)
      ? config.preset
      : 'default'
  const preset = {
    ...FAST_NOTE_PRESETS.default,
    ...FAST_NOTE_PRESETS[presetKey],
  } as PresetDefaults
  const text = (
    key: Exclude<keyof PresetDefaults, 'saveMode' | 'folderPreset'>
  ) => (nonBlank(config?.[key]) ? config[key] : preset[key])

  return {
    saveMode: SAVE_MODES.includes(config?.saveMode as FastNoteSaveMode)
      ? config!.saveMode!
      : preset.saveMode,
    folderPreset: FOLDER_PRESETS.includes(
      config?.folderPreset as FastNoteFolderPreset
    )
      ? config!.folderPreset!
      : preset.folderPreset,
    customSubfolderTemplate: text('customSubfolderTemplate'),
    fileNameTemplate: text('fileNameTemplate'),
    contentTemplate: text('contentTemplate'),
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
    : base.replace(/[/\\]+$/, '') || (base.startsWith('/') ? '/' : '')
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
      subfolder = renderTemplate(customSubfolderTemplate, tokens)
      break
    case 'flat':
    default:
      subfolder = ''
      break
  }

  const cleanSubfolder = subfolder.replace(/^\/+|\/+$/g, '')
  return cleanSubfolder
    ? `${trimmedBase}${trimmedBase.endsWith('/') ? '' : '/'}${cleanSubfolder}`
    : trimmedBase
}

/** An extension written in the template, e.g. `.md`; a title never adds one. */
const FILE_EXTENSION = /\.[a-zA-Z][a-zA-Z0-9]{0,9}$/

export function resolveNoteFileName(
  fileNameTemplate: string,
  date: Date,
  text: string
): string {
  const dateTokens = getDateTokens(date)
  const day = `${dateTokens.YYYY}-${dateTokens.MM}-${dateTokens.DD}`
  const fallback = `${day}_${dateTokens.HH}-${dateTokens.mm}-${dateTokens.ss}.md`
  const title = sanitizeFileName(extractTitle(text, MAX_TITLE_LENGTH))
  const slug = slugify(title)

  const template = nonBlank(fileNameTemplate)
    ? fileNameTemplate
    : DEFAULT_FILE_NAME_TEMPLATE
  const name = sanitizeFileName(
    renderTemplate(template, {
      ...dateTokens,
      title: title || day,
      slug: slug || day,
    })
  )
  const written = FILE_EXTENSION.test(template)
    ? name.match(FILE_EXTENSION)?.[0]
    : undefined
  const extension = written ?? '.md'
  const stem = written ? name.slice(0, -written.length) : name
  const shortStem = sanitizeFileName(
    truncateUtf8(
      stem,
      MAX_FILE_NAME_BYTES - new TextEncoder().encode(extension).length
    )
  )
  return shortStem ? `${shortStem}${extension}` : fallback
}

/** A YAML scalar of a value, inside the quotes the template already has. */
function yamlValue(value: string, quote: '"' | "'" | ''): string {
  if (quote === "'") return value.replace(/'/g, "''").replace(/\n/g, ' ')
  const json = JSON.stringify(value)
  return quote === '"' ? json.slice(1, -1) : json
}

/** Drops the first non-empty line and the blank lines after it. */
function withoutFirstLine(text: string): string {
  const lines = text.split('\n')
  lines.splice(0, lines.findIndex((line) => line.trim()) + 1)
  while (lines.length && !lines[0]!.trim()) lines.shift()
  return lines.join('\n')
}

/**
 * What continues the line of `{content}` on its next lines: the quote marks and
 * the indentation of a list item, so a multi-line text stays inside them.
 */
function continuationPrefix(contentTemplate: string): string {
  const line = contentTemplate
    .split('\n')
    .find((candidate) => candidate.includes('{content}'))
  if (line === undefined) return ''
  const before = line.slice(0, line.indexOf('{content}'))
  const quote = before.match(/^[ \t]*(?:>[ \t]?)*/)![0]
  const list = before
    .slice(quote.length)
    .match(/^([ \t]*)((?:[-+*]|\d+[.)])[ \t]+)/)
  return list ? `${quote}${list[1]}${list[2]!.replace(/[^\t]/g, ' ')}` : quote
}

/** The leading `---` block of a template, as YAML front matter. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---(?:\n|$)/

export function resolveNoteContent(
  contentTemplate: string,
  text: string,
  date: Date
): string {
  const template = normalizeLineEndings(contentTemplate)
  const normalized = normalizeLineEndings(text)
  const title = extractTitle(normalized)
  // A heading made of the title already shows the first line.
  const body =
    title && /(?:^|\n)[ \t]*#{1,6}[ \t]+\{title\}/.test(template)
      ? withoutFirstLine(normalized)
      : normalized
  const prefix = continuationPrefix(template)
  const content = prefix
    ? body
        .split('\n')
        .map((line, index) =>
          index === 0 ? line : line ? `${prefix}${line}` : prefix.trimEnd()
        )
        .join('\n')
    : body
  const tokens = { ...getDateTokens(date), title, content }

  const frontMatter = template.match(FRONT_MATTER)?.[0] ?? ''
  const result =
    renderTemplate(frontMatter, tokens, (name, value, quote) =>
      name === 'title' || name === 'content' ? yamlValue(value, quote) : value
    ) + renderTemplate(template.slice(frontMatter.length), tokens)

  return result.endsWith('\n') ? result : `${result}\n`
}

export type FastNoteIssueCode =
  | 'noNotesPath'
  | 'invalidNotesPath'
  | 'invalidSubfolder'
  | 'unknownTemplateToken'
  | 'missingContentToken'
  | 'invalidFileName'

export interface FastNoteIssue {
  code: FastNoteIssueCode
  /** The token `unknownTemplateToken` is about */
  token?: string
}

/** A subfolder name the supported file systems all take. */
function isValidFolderName(name: string): boolean {
  return (
    name !== '..' &&
    (name === '.' || !/[. ]$/.test(name)) &&
    !WINDOWS_RESERVED_NAME.test(name)
  )
}

/** Validates templates before writing or clearing any editor content. */
export function validateFastNoteConfig(
  config: Partial<FastNoteConfig>
): FastNoteIssue[] {
  const issues: FastNoteIssue[] = []
  const path = config.pathToNotes?.trim() ?? ''
  if (!path) issues.push({ code: 'noNotesPath' })
  else if (
    !/^(?:\/|[a-zA-Z]:[/\\]|\\\\|~(?:[/\\]|$))/.test(path) ||
    /\p{Cc}/u.test(path) ||
    path.split(/[/\\]/).includes('..')
  )
    issues.push({ code: 'invalidNotesPath' })
  const effective = getEffectiveConfig(config)
  const templates: Array<[string, string[]]> = [
    [effective.fileNameTemplate, [...DATE_TOKEN_NAMES, 'title', 'slug']],
    [effective.contentTemplate, [...DATE_TOKEN_NAMES, 'title', 'content']],
  ]
  if (effective.folderPreset === 'custom') {
    const folder = effective.customSubfolderTemplate
    templates.push([folder, DATE_TOKEN_NAMES])
    if (
      /^(?:\/|[a-zA-Z]:)/.test(folder) ||
      /[\\:*?"<>|\p{Cc}]/u.test(folder) ||
      !folder
        .split('/')
        .filter(Boolean)
        .every((name) => isValidFolderName(name))
    )
      issues.push({ code: 'invalidSubfolder' })
  }
  const unknownToken = templates
    .flatMap(([template, names]) =>
      templateTokenNames(template).filter((name) => !names.includes(name))
    )
    .at(0)
  if (unknownToken !== undefined)
    issues.push({ code: 'unknownTemplateToken', token: unknownToken })
  if (!templateTokenNames(effective.contentTemplate).includes('content'))
    issues.push({ code: 'missingContentToken' })
  if (/\p{Cc}/u.test(effective.fileNameTemplate))
    issues.push({ code: 'invalidFileName' })
  return issues
}
