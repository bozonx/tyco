import type { AiFileRoot, AiFileToolOutput } from '@tyco/shared'

/** Room kept in a page of a file for the note that tells how to read on */
export const PAGE_NOTE_CHARACTERS = 200

/** One page of a text, by lines */
export interface TextPage {
  content: string
  startLine: number
  endLine: number
  totalLines: number
  /** The offset to read on from; absent at the end */
  nextOffset?: number
  /** Unicode scalar values to skip in a partially read line */
  nextCharacterOffset?: number
}

/**
 * Whole lines from `offset` (from 1), at most `limit` of them and
 * `maxCharacters` in all; a partial line has a continuation cursor. The same
 * paging as Rust's for text files, for the text of a document read here
 */
export function pageText(
  text: string,
  offset = 1,
  limit = Number.POSITIVE_INFINITY,
  maxCharacters = Number.POSITIVE_INFINITY,
  characterOffset = 0
): TextPage {
  if (!Number.isSafeInteger(characterOffset) || characterOffset < 0)
    throw new Error('characterOffset must be a non-negative safe integer')
  if (maxCharacters <= 0)
    throw new Error('maxCharacters must be greater than zero')
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const totalLines = lines.length
  if (totalLines === 0)
    return { content: '', startLine: 0, endLine: 0, totalLines }
  const start = Math.max(1, offset) - 1
  if (start >= totalLines)
    throw new Error(
      `Offset ${offset} is past the end: the text has ${totalLines} lines`
    )
  if (
    characterOffset > 0 &&
    characterOffset >= Array.from(lines[start]!).length
  )
    throw new Error('characterOffset is past the end of the line')
  let nextCharacterOffset: number | undefined
  let content = ''
  let end = start
  let characters = 0
  for (const line of lines.slice(start, start + Math.max(1, limit))) {
    const skipped = end === start ? characterOffset : 0
    const remaining = Array.from(line).slice(skipped)
    if (characters + remaining.length > maxCharacters) {
      if (end === start) {
        content = remaining.slice(0, maxCharacters).join('')
        nextCharacterOffset = skipped + maxCharacters
      }
      break
    }
    content += remaining.join('')
    characters += remaining.length
    end += 1
  }
  return {
    content,
    startLine: start + 1,
    endLine: nextCharacterOffset === undefined ? end : end + 1,
    totalLines,
    ...(end < totalLines ? { nextOffset: end + 1 } : {}),
    ...(nextCharacterOffset === undefined ? {} : { nextCharacterOffset }),
  }
}

/** A page as the model gets it: whole, or with a note on how to read on */
export function formatTextPage(page: TextPage, path: string): string {
  if (page.totalLines === 0) return `${path} is empty.`
  if (page.startLine === 1 && page.nextOffset === undefined) return page.content
  const range = `Lines ${page.startLine}-${page.endLine} of ${page.totalLines} of ${path}.`
  const continuation =
    page.nextCharacterOffset === undefined
      ? ''
      : ` and characterOffset ${page.nextCharacterOffset}`
  return page.nextOffset === undefined
    ? `${page.content}\n\n[${range}]`
    : `${page.content}\n\n[${range} Call read_file with offset ${page.nextOffset}${continuation} for more.]`
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

/** What a file tool did, as the model gets it */
export function formatFileToolOutput(output: AiFileToolOutput): string {
  switch (output.operation) {
    case 'listDir': {
      if (output.entries.length === 0)
        return output.path ? `${output.path} is empty.` : 'No folders.'
      const lines = output.entries.map((entry) =>
        entry.size === undefined
          ? entry.path
          : `${entry.path} (${plural(entry.size, 'byte')})`
      )
      if (output.isTruncated)
        lines.push(
          '[Listing truncated: list a subfolder, or use a pattern, to see more.]'
        )
      return lines.join('\n')
    }
    case 'readFile':
      return formatTextPage(output, output.path)
    case 'readDocument':
      // the provider reads the text of a document itself
      return output.path
    case 'searchFiles': {
      if (output.matches.length === 0) return 'No matches.'
      const lines = output.matches.map((match) =>
        match.line === undefined
          ? match.path
          : `${match.path}:${match.line}: ${match.text ?? ''}`
      )
      if (output.isTruncated)
        lines.push(
          '[Results truncated: narrow the search with a path or a namePattern.]'
        )
      return lines.join('\n')
    }
    case 'writeFile':
      return `${output.isCreated ? 'Created' : 'Wrote'} ${output.path} (${plural(output.bytes, 'byte')}).`
    case 'editFile':
      return `Edited ${output.path}: ${plural(output.replacementCount, 'replacement')}.`
    case 'movePath':
      return `Moved ${output.from} to ${output.to}.`
    case 'deletePath':
      return `Moved ${output.path} to the trash.`
  }
}

const ACCESS_TEXT = {
  allow: 'allowed',
  ask: 'asks the user first',
  deny: 'not allowed',
} as const

/** What the model is told about the folders it reaches */
export function formatFileRoots(roots: readonly AiFileRoot[]): string {
  const lines = roots.map((root) => {
    if (!root.name)
      return `- ${root.path}/ — your own folder for notes, drafts and files the user drops into the chat (in ${root.path}/uploads/).`
    const about = root.description ? ` (${root.description})` : ''
    return `- ${root.path}/ — the project "${root.name}"${about}; reading ${ACCESS_TEXT[root.read]}, changing ${ACCESS_TEXT[root.write]}.`
  })
  return [
    'You can work with files through the file tools. Every path starts with one of these folders:',
    ...lines,
    'Read a file before you change it: edit_file needs text copied exactly from the file. Deleted files go to the trash.',
  ].join('\n')
}
