/** Maximum tool name length accepted by the supported provider contract. */
export const MAX_TOOL_NAME_LENGTH = 64
/** A 128-bit digest suffix leaves room for a readable tool prefix. */
const TOOL_NAME_HASH_BYTES = 16
const UNSAFE_NAME_CHARACTERS = /[^a-zA-Z0-9_-]/g

export async function chatToolName(toolId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(toolId)
  )
  const suffix = Array.from(
    new Uint8Array(digest).subarray(0, TOOL_NAME_HASH_BYTES),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
  const prefix = toolId
    .replace(UNSAFE_NAME_CHARACTERS, '_')
    .slice(0, MAX_TOOL_NAME_LENGTH - suffix.length - 1)
  return `${prefix}_${suffix}`
}
