import { describe, expect, it } from 'vitest'
import type { ProfileMemoryTopic } from '@tyco/shared'

import {
  buildProfileMemoryBlock,
  clipCoreMemory,
  CORE_MEMORY_HARD_LIMIT_TOKENS,
  CORE_MEMORY_WARN_TOKENS,
  detectMemoryWarnings,
  estimateMemoryTokens,
  formatMemoryTopicSize,
  formatTopicsList,
  tokensToCharacters,
  TOPIC_MEMORY_WARN_TOKENS,
} from './chat-profile-memory'

describe('chat-profile-memory', () => {
  it('estimates tokens and converts tokens to characters', () => {
    expect(estimateMemoryTokens('abc')).toBe(1)
    expect(estimateMemoryTokens('abcdef')).toBe(2)
    expect(tokensToCharacters(10)).toBe(30)
  })

  it('formats topic sizes in KB and MB', () => {
    expect(formatMemoryTopicSize(400)).toBe('0.4 КБ')
    expect(formatMemoryTopicSize(2150)).toBe('2.1 КБ')
    expect(formatMemoryTopicSize(1024 * 1024 * 1.5)).toBe('1.5 МБ')
  })

  it('formats topics list with descriptions or titles', () => {
    const topics: ProfileMemoryTopic[] = [
      {
        file: 'health.md',
        title: 'Health',
        description: 'История болезней и анализы',
        bytes: 2150,
        updatedAt: 1,
      },
      {
        file: 'preferences.md',
        title: 'Preferences',
        description: 'Стиль ответов',
        bytes: 410,
        updatedAt: 1,
      },
      { file: 'notes.md', title: 'Notes', bytes: 1024, updatedAt: 1 },
    ]

    expect(formatTopicsList(topics)).toBe(
      `- health.md — История болезней и анализы (~717 tokens)\n- preferences.md — Стиль ответов (~137 tokens)\n- notes.md — Notes (~342 tokens)`
    )
    expect(formatTopicsList([])).toBe('(no topics yet)')
  })

  it('does not clip core.md within hard limit', () => {
    const content = '# Core\n- Fact 1\n- Fact 2'
    const result = clipCoreMemory(content)
    expect(result.isClipped).toBe(false)
    expect(result.text).toBe(content)
  })

  it('clips core.md exceeding hard limit', () => {
    const longContent = 'word '.repeat(CORE_MEMORY_HARD_LIMIT_TOKENS + 500)
    const result = clipCoreMemory(longContent)
    expect(result.isClipped).toBe(true)
    expect(result.tokens).toBeLessThanOrEqual(CORE_MEMORY_HARD_LIMIT_TOKENS)
  })

  it('detects warnings for large core.md and topics', () => {
    const topics: ProfileMemoryTopic[] = [
      {
        file: 'health.md',
        title: 'Health',
        bytes: tokensToCharacters(TOPIC_MEMORY_WARN_TOKENS + 300),
        updatedAt: 1,
      },
    ]

    const warnings = detectMemoryWarnings({
      coreTokens: CORE_MEMORY_WARN_TOKENS + 100,
      isCoreClipped: false,
      topics,
    })

    expect(warnings.length).toBe(2)
    expect(warnings[0]).toContain(
      'core.md is 1100 tokens, over the 1000 token budget'
    )
    expect(warnings[1]).toContain(
      'health.md is 2800 tokens, over the 2500 token budget'
    )
  })

  it('builds full profile memory block according to spec', () => {
    const topics: ProfileMemoryTopic[] = [
      {
        file: 'health.md',
        title: 'Health',
        description: 'История болезней и анализы',
        bytes: 2150,
        updatedAt: 1,
      },
      {
        file: 'preferences.md',
        title: 'Preferences',
        description: 'Стиль ответов',
        bytes: 410,
        updatedAt: 1,
      },
    ]

    const coreText = '# Ядро памяти\n\n## О пользователе\n- Имя: Иван'
    const memoryContext = buildProfileMemoryBlock({ coreText, topics })

    expect(memoryContext.block).toContain('<profile_memory>')
    expect(memoryContext.block).toContain(
      'Notes about the user saved in earlier conversations.'
    )
    expect(memoryContext.block).toContain('<core>\n' + coreText + '\n</core>')
    expect(memoryContext.block).toContain(
      '- health.md — История болезней и анализы (~717 tokens)'
    )
    expect(memoryContext.block).toContain('</profile_memory>')
  })
})
