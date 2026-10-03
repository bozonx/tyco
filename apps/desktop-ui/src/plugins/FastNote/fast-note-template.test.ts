import { describe, expect, it } from 'vitest'

import {
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
} from './fast-note-template'

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
      zettel: '202610030730',
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
      'Meeting with John- 10-10-2026'
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
    ).toBe('202610030730 Project Kickoff.md')

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
