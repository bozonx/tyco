import { describe, expect, it, vi } from 'vitest'

import {
  buildMemoryCompactionPrompt,
  cleanCompactedMarkdown,
  compactMemoryContent,
} from './memory-compaction'

describe('memory-compaction', () => {
  it('builds a prompt mentioning the target file and rules', () => {
    const prompt = buildMemoryCompactionPrompt(
      'health.md',
      '- Coffee: headache'
    )
    expect(prompt.system).toContain('health.md')
    expect(prompt.system).toContain('duplicates')
    expect(prompt.messages[0].content).toContain('Coffee: headache')
  })

  it('cleans surrounding markdown fences', () => {
    const fenced = '```markdown\n# Health\n- Fact\n```'
    expect(cleanCompactedMarkdown(fenced)).toBe('# Health\n- Fact')

    const fencedPlain = '```\n# Plain\n```'
    expect(cleanCompactedMarkdown(fencedPlain)).toBe('# Plain')

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
