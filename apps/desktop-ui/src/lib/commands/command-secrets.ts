import type { CommandConfig } from '@tyco/shared'

import { secretIdFromRef } from '../net/secrets'
import { webhookToolConfig } from './command-config'

/**
 * The secrets a command refers to: the Authorization secret of a webhook and
 * the secret references among its headers
 */
export function commandSecretIds(command: CommandConfig): string[] {
  if (command.toolId !== 'webhook') return []
  const tool = webhookToolConfig(command)
  const ids = new Set(
    Object.values(tool.headers ?? {}).flatMap((value) => {
      const id = secretIdFromRef(value)
      return id ? [id] : []
    })
  )
  if (tool.authSecretId) ids.add(tool.authSecretId)
  return [...ids]
}

/** Whether a command of `commands` refers to the secret `id` */
export const isSecretReferenced = (
  commands: readonly CommandConfig[],
  id: string
): boolean => commands.some((command) => commandSecretIds(command).includes(id))
