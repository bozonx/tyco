import { describe, expect, it } from 'vitest'

import {
  appendMemoryBullet,
  applyMemoryReplace,
  createMemoryTopic,
  formatMemoryBullet,
  normalizeMemorySection,
} from './memory-markdown'

// Cases match the Rust tests of `append_memory_bullet`.
describe('memory-markdown', () => {
  it('appends to the end of a matching section', () => {
    const text =
      '# Core\n\n## About the user\n\n- Lives in Kazan\n\n## Standing rules\n'
    const next = appendMemoryBullet(text, '- Has a dog', 'about the USER')
    expect(next).toBe(
      '# Core\n\n## About the user\n\n- Lives in Kazan\n- Has a dog\n\n## Standing rules\n'
    )
    expect(
      appendMemoryBullet(next, '- Answer briefly', 'Standing rules')
    ).toMatch(/## Standing rules\n\n- Answer briefly\n$/)
  })

  it('creates a missing section or appends without one', () => {
    expect(appendMemoryBullet('# Core\n\n- a\n', '- b', 'Work')).toBe(
      '# Core\n\n- a\n\n## Work\n\n- b\n'
    )
    expect(appendMemoryBullet('# Core\n- a', '- b')).toBe('# Core\n- a\n- b\n')
    expect(
      appendMemoryBullet('## A\n- a\n### A1\n- a1\n## B\n', '- x', 'A')
    ).toBe('## A\n- a\n### A1\n- a1\n- x\n\n## B\n')
  })

  it('formats bullets, sections and new topics like the backend', () => {
    expect(formatMemoryBullet(' fact ')).toBe('- fact')
    expect(formatMemoryBullet('* fact')).toBe('* fact')
    expect(normalizeMemorySection(' ## Work ')).toBe('Work')
    expect(normalizeMemorySection('  ')).toBeUndefined()
    expect(
      createMemoryTopic({
        file: 'health.md',
        bullet: '- Lactose intolerance',
        description: 'Diet,\n allergies and conditions',
      })
    ).toBe(
      '# Health\n\nDiet, allergies and conditions\n\n- Lactose intolerance\n'
    )
  })
})

describe('applyMemoryReplace', () => {
  it('keeps replacement patterns literal', () => {
    expect(applyMemoryReplace('- old\n', 'old', 'cost $& more')).toBe(
      '- cost $& more\n'
    )
  })

  it('removes the line ending with a removed line', () => {
    expect(applyMemoryReplace('- a\n- b\n', '- a', '')).toBe('- b\n')
    expect(applyMemoryReplace('- a\r\n- b\r\n', '- a\n- b', '- c')).toBe(
      '- c\r\n'
    )
  })

  it('refuses text that is missing or not unique', () => {
    expect(applyMemoryReplace('- a\n- a\n', '- a', '- b')).toBeUndefined()
    expect(applyMemoryReplace('- a\n', '- z', '- b')).toBeUndefined()
  })

  it('keeps a multi-line fact one bullet', () => {
    expect(formatMemoryBullet('first\n# Not a section')).toBe(
      '- first\n  \\# Not a section'
    )
  })
})
