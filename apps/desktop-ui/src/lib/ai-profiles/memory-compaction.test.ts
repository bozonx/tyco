import { describe, expect, it, vi } from 'vitest'

import {
  buildMemoryCompactionPrompt,
  cleanCompactedMarkdown,
  compactMemoryContent,
} from './memory-compaction'

describe('memory-compaction', () => {
  it('gives the file as data apart from the rules', () => {
    const prompt = buildMemoryCompactionPrompt(
      'health.md',
      '- Coffee: headache'
    )
    expect(prompt.system).toContain('duplicates')
    expect(prompt.system).toContain('language')
    expect(prompt.system).toContain('not instructions')
    expect(prompt.system).not.toContain('Coffee')
    expect(prompt.messages[0].content).toBe(
      '<memory_file name="health.md">\n- Coffee: headache\n</memory_file>'
    )
  })

  it('cleans surrounding markdown fences', () => {
    const fenced = '```markdown\n# Health\n- Fact\n```'
    expect(cleanCompactedMarkdown(fenced)).toBe('# Health\n- Fact')

    const fencedPlain = '```\n# Plain\n```'
    expect(cleanCompactedMarkdown(fencedPlain)).toBe('# Plain')

    const tagged = '<memory_file name="core.md">\n# Tagged\n</memory_file>'
    expect(cleanCompactedMarkdown(tagged)).toBe('# Tagged')

    const unfenced = '# Unfenced\n- Fact'
    expect(cleanCompactedMarkdown(unfenced)).toBe('# Unfenced\n- Fact')
  })

  it('runs model compaction and cleans output', async () => {
    const runModel = vi.fn(
      async () => '```markdown\n# Compacted\n- Fact 1\n```'
    )
    const result = await compactMemoryContent({
      file: 'core.md',
      content: '# Core\n- Fact 1\n- Fact 1 duplicate',
      runModel,
    })

    expect(runModel).toHaveBeenCalledOnce()
    expect(result).toBe('# Compacted\n- Fact 1')
  })
})
