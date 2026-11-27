import type { CommandConfig } from '@tyco/shared'

import { secretIdFromRef } from '../net/secrets'
import { webhookOperationConfig } from './command-config'

/**
 * The secrets a command refers to: the secret references among the headers of a
 * webhook
 */
export function commandSecretIds(command: CommandConfig): string[] {
  if (command.operationId !== 'webhook') return []
  const tool = webhookOperationConfig(command)
  const ids = new Set(
    Object.values(tool.headers).flatMap((value) => {
      const id = secretIdFromRef(value)
      return id ? [id] : []
    })
  )
  return [...ids]
}

/** Whether a command of `commands` refers to the secret `id` */
export const isSecretReferenced = (
  commands: readonly CommandConfig[],
  id: string
): boolean => commands.some((command) => commandSecretIds(command).includes(id))
