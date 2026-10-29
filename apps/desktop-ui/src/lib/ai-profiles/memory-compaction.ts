import type { LlmPrompt } from '../llm/llm-prompt'

export interface MemoryCompactionOptions {
  file: string
  content: string
  runModel: (prompt: LlmPrompt) => Promise<string>
}

/** Builds the prompt to compact a memory file. */
export function buildMemoryCompactionPrompt(
  file: string,
  content: string
): LlmPrompt {
  return {
    system: [
      'You are a long-term memory organizer.',
      `The user has provided the contents of their long-term memory file "${file}".`,
      'Your task is to compact and optimize this file:',
      '1. Remove exact and near duplicates.',
      '2. Combine related facts or bullet points into concise summaries.',
      '3. Remove obsolete, superseded, or contradictory items.',
      '4. Preserve all important facts, dates, decisions, and preferences.',
      '5. Maintain standard Markdown formatting (headers, bullet lists).',
      '6. Return ONLY the updated Markdown file content without commentary, intros, or outer code blocks.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Here is the current content of "${file}":\n\n${content}`,
      },
    ],
  }
}

/**
 * Strips surrounding markdown fences if the model wrapped the entire output in
 * them.
 */
export function cleanCompactedMarkdown(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = /^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i.exec(
    trimmed
  )
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }
  return trimmed
}

/** Runs AI compaction on memory file content and returns the cleaned result. */
export async function compactMemoryContent(
  options: MemoryCompactionOptions
): Promise<string> {
  const prompt = buildMemoryCompactionPrompt(options.file, options.content)
  const result = await options.runModel(prompt)
  return cleanCompactedMarkdown(result)
}
