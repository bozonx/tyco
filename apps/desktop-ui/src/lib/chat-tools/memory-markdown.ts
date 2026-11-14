// Mirrors `append_memory_bullet` and topic creation in
// `src-tauri/src/services/ai_vault/memory.rs` so previews match the write.

export function formatMemoryBullet(fact: string): string {
  const trimmed = fact.trim()
  return trimmed.startsWith('-') || trimmed.startsWith('*')
    ? trimmed
    : `- ${trimmed}`
}

export function normalizeMemorySection(
  section: string | undefined
): string | undefined {
  const value = section?.trim().replace(/^#+/, '').trim()
  return value ? value : undefined
}

function markdownHeading(
  line: string
): { level: number; text: string } | undefined {
  const match = /^\s*(#{1,6})(?:\s(.*))?$/.exec(line)
  if (!match) return undefined
  return { level: match[1].length, text: (match[2] ?? '').trim() }
}

/** Appends a bullet to the end of a section, a new section or the file. */
export function appendMemoryBullet(
  text: string,
  bullet: string,
  section?: string
): string {
  if (!section) {
    const base = text && !text.endsWith('\n') ? `${text}\n` : text
    return `${base}${bullet}\n`
  }
  const wanted = section.toLowerCase()
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const start = lines.findIndex(
    (line) => markdownHeading(line)?.text.toLowerCase() === wanted
  )
  if (start < 0) {
    const base = text.trimEnd()
    return `${base ? `${base}\n\n` : ''}## ${section}\n\n${bullet}\n`
  }
  const level = markdownHeading(lines[start])!.level
  const offset = lines
    .slice(start + 1)
    .findIndex((line) => (markdownHeading(line)?.level ?? 7) <= level)
  const end = offset < 0 ? lines.length : start + 1 + offset
  let insertAt = end
  while (insertAt > start + 1 && !lines[insertAt - 1].trim()) insertAt -= 1
  const out = lines.slice(0, insertAt)
  if (insertAt === start + 1) out.push('')
  out.push(bullet)
  if (end < lines.length) out.push('', ...lines.slice(end))
  return `${out.join('\n')}\n`
}

function formatStemToTitle(stem: string): string {
  return stem
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Content of a topic file created by its first fact. */
export function createMemoryTopic(options: {
  file: string
  bullet: string
  section?: string
  description?: string
}): string {
  const title = formatStemToTitle(options.file.replace(/\.md$/, ''))
  const description = (options.description ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(/^[#\-* ]+/, '')
  const header = `# ${title}\n\n${description ? `${description}\n\n` : ''}`
  return appendMemoryBullet(header, options.bullet, options.section)
}
