import { describe, expect, it } from 'vitest'

import {
  FAST_NOTE_PRESETS,
  validateFastNoteConfig,
  extractTitle,
  getDateTokens,
  getEffectiveConfig,
  getIsoWeekNumber,
  renderTemplate,
  resolveNoteContent,
  resolveNoteDir,
  resolveNoteFileName,
  sanitizeFileName,
  slugify,
} from './fast-note-template.js'

describe('fast-note-template', () => {
  const fixedDate = new Date(2026, 9, 3, 7, 30, 45) // 2026-10-03 07:30:45

  it('computes correct ISO week number', () => {
    // 2026-10-03 is Saturday in week 40
    expect(getIsoWeekNumber(fixedDate)).toBe(40)
  })

  it('provides all expected date tokens', () => {
    const tokens = getDateTokens(fixedDate)
    expect(tokens).toMatchObject({
      YYYY: '2026',
      YY: '26',
      MM: '10',
      DD: '03',
      HH: '07',
      mm: '30',
      ss: '45',
      WW: '40',
      zettel: '20261003073045000',
    })
  })

  it('extracts title and strips markdown header or list prefixes', () => {
    expect(extractTitle('# Hello World\nSecond line')).toBe('Hello World')
    expect(extractTitle('###   Subheading   \nBody')).toBe('Subheading')
    expect(extractTitle('- [ ] My Todo item\nDetails')).toBe('My Todo item')
    expect(extractTitle('> Quote block')).toBe('Quote block')
    expect(extractTitle('')).toBe('')
  })

  it('sanitizes illegal characters in titles and filenames', () => {
    expect(sanitizeFileName('foo/bar:baz*qux?"<>|')).toBe('foo-bar-baz-qux-')
    expect(extractTitle('Meeting with John: 10/10/2026')).toBe(
      'Meeting with John: 10/10/2026'
    )
  })

  it('slugifies text for URL/file friendly names', () => {
    expect(slugify('Hello World! 2026')).toBe('hello-world-2026')
    expect(slugify('Моя Заметка')).toBe('моя-заметка')
  })

  it('renders templates with token substitution', () => {
    const res = renderTemplate('{YYYY}/{MM}/{slug}', {
      YYYY: '2026',
      MM: '10',
      slug: 'my-note',
    })
    expect(res).toBe('2026/10/my-note')
  })

  it('resolves note directory based on folderPreset', () => {
    expect(resolveNoteDir('/vault', 'flat', '', fixedDate)).toBe('/vault')
    expect(resolveNoteDir('/vault/', 'year', '', fixedDate)).toBe('/vault/2026')
    expect(resolveNoteDir('~/notes', 'year_month', '', fixedDate)).toBe(
      '~/notes/2026/10'
    )
    expect(resolveNoteDir('/vault', 'year_month_flat', '', fixedDate)).toBe(
      '/vault/2026-10'
    )
    expect(resolveNoteDir('/vault', 'year_week', '', fixedDate)).toBe(
      '/vault/2026/W40'
    )
    expect(
      resolveNoteDir('/vault', 'custom', 'inbox/{YYYY}/{WW}', fixedDate)
    ).toBe('/vault/inbox/2026/40')
  })

  it('resolves note filename with tokens and fallback', () => {
    expect(
      resolveNoteFileName(
        '{YYYY}-{MM}-{DD}_{HH}-{mm}-{ss}.md',
        fixedDate,
        'Hello'
      )
    ).toBe('2026-10-03_07-30-45.md')

    expect(
      resolveNoteFileName('{zettel} {title}.md', fixedDate, '# Project Kickoff')
    ).toBe('20261003073045000 Project Kickoff.md')

    expect(
      resolveNoteFileName('{YYYY}-{MM}-{DD} - {slug}', fixedDate, 'My Note')
    ).toBe('2026-10-03 - my-note.md')
  })

  it('resolves note content for create and append modes', () => {
    // Default create mode
    expect(
      resolveNoteContent('create', '{content}', 'Sample text', fixedDate)
    ).toBe('Sample text\n')

    // Append mode with default format
    expect(resolveNoteContent('append', '', 'An item', fixedDate)).toBe(
      '- **07:30**: An item\n'
    )

    // Obsidian frontmatter template
    const frontmatterTpl =
      '---\ndate: {YYYY}-{MM}-{DD}\n---\n\n# {title}\n\n{content}'
    expect(
      resolveNoteContent(
        'create',
        frontmatterTpl,
        'First line\nBody text',
        fixedDate
      )
    ).toBe(
      '---\ndate: 2026-10-03\n---\n\n# First line\n\nFirst line\nBody text\n'
    )
  })

  it('applies preset defaults in getEffectiveConfig', () => {
    const dailyDefaults = getEffectiveConfig({ preset: 'obsidian_daily' })
    expect(dailyDefaults.saveMode).toBe('append')
    expect(dailyDefaults.fileNameTemplate).toBe('{YYYY}-{MM}-{DD}.md')
    expect(dailyDefaults.contentTemplate).toBe('- **{HH}:{mm}**: {content}')

    const zettelDefaults = getEffectiveConfig({ preset: 'obsidian_zettel' })
    expect(zettelDefaults.saveMode).toBe('create')
    expect(zettelDefaults.fileNameTemplate).toBe('{zettel} {title}.md')
  })
})

describe('fast note edge cases', () => {
  const date = new Date(2021, 0, 1, 12)
  it('uses the ISO week year and handles DST independently of local clock changes', () => {
    expect(resolveNoteDir('/notes', 'year_week', '', date)).toBe(
      '/notes/2020/W53'
    )
    expect(getDateTokens(new Date(2024, 11, 30))).toMatchObject({
      GGGG: '2025',
      WW: '01',
    })
  })
  it('preserves filesystem roots', () => {
    expect(resolveNoteDir('/', 'flat', '', date)).toBe('/')
    expect(resolveNoteDir('/', 'year', '', date)).toBe('/2021')
    expect(resolveNoteDir('C:\\', 'flat', '', date)).toBe('C:/')
  })
  it('adds markdown extensions to dotted titles and sanitizes Windows names', () => {
    expect(resolveNoteFileName('{title}', date, 'Release 1.2')).toBe(
      'Release 1.2.md'
    )
    expect(resolveNoteFileName('{title}', date, 'Release 1.beta')).toBe(
      'Release 1.beta.md'
    )
    expect(resolveNoteFileName('{title}.txt', date, 'Note')).toBe('Note.txt')
    expect(resolveNoteFileName('{title}.md', date, 'CON')).toBe('_CON.md')
    expect(sanitizeFileName('bad\u0001name.')).toBe('bad-name')
  })
  it('keeps punctuation and full titles in content and avoids duplicate headings', () => {
    const title = 'Meeting: API/UI ' + 'x'.repeat(100)
    const config = getEffectiveConfig({ preset: 'obsidian_zettel' })
    const content = resolveNoteContent(
      'create',
      config.contentTemplate,
      `# ${title}\n\nDetails`,
      date
    )
    expect(content).toContain(`# ${title}\n\nDetails`)
    expect(content.match(/# Meeting/g)).toHaveLength(1)
  })
  it('keeps multiline lists, nested blocks and fenced code inside a journal entry', () => {
    const input = 'First\n- nested\n\n```ts\nconst value = 1\n```'
    expect(resolveNoteContent('append', '- {content}', input, date)).toBe(
      '- First\n  - nested\n  \n  ```ts\n  const value = 1\n  ```\n'
    )
    expect(
      resolveNoteContent(
        'append',
        '- **{HH}:{mm}**: {content}',
        'First\nSecond',
        date
      )
    ).toBe('- **12:00**: First\n  Second\n')
  })
  it('validates all built-in presets and rejects invalid templates and paths', () => {
    for (const preset of Object.keys(FAST_NOTE_PRESETS)) {
      expect(
        validateFastNoteConfig({
          pathToNotes: '/notes',
          preset: preset as keyof typeof FAST_NOTE_PRESETS,
        })
      ).toEqual([])
    }
    expect(validateFastNoteConfig({ pathToNotes: 'relative' })).toContain(
      'invalidNotesPath'
    )
    expect(
      validateFastNoteConfig({
        pathToNotes: '/notes',
        contentTemplate: '# {title}',
      })
    ).toContain('missingContentToken')
    expect(
      validateFastNoteConfig({
        pathToNotes: '/notes',
        fileNameTemplate: '{typo}.md',
      })
    ).toContain('unknownTemplateToken')
    expect(
      validateFastNoteConfig({
        pathToNotes: '/notes',
        folderPreset: 'custom',
        customSubfolderTemplate: '../outside',
      })
    ).toContain('invalidSubfolder')
    expect(
      validateFastNoteConfig({
        pathToNotes: '/notes',
        folderPreset: 'flat',
        customSubfolderTemplate: '{unused}',
      })
    ).toEqual([])
  })
})
