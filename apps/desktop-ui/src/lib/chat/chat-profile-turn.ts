import type { AiProfile } from '@tyco/shared'

import type { createDesktopChatTools } from '../chat-tools/desktop-chat-tools'

type TurnTools = Pick<ReturnType<typeof createDesktopChatTools>, 'turnTools'>

/**
 * The call settings a profile gives one turn: its tools and memory, its
 * temperature and output limit. The main chat and the quick request of a
 * profile share them, so a turn asks the model the same way in both
 */
export async function profileTurnOptions(
  tools: TurnTools,
  modelId: string,
  toolOutputBudgetCharacters: number | undefined,
  profile:
    | Pick<
        AiProfile,
        'tools' | 'memoryMode' | 'temperature' | 'maxOutputTokens'
      >
    | undefined
) {
  return {
    ...(await tools.turnTools(
      modelId,
      toolOutputBudgetCharacters,
      profile?.tools,
      profile?.memoryMode
    )),
    temperature: profile?.temperature,
    maxOutputTokens: profile?.maxOutputTokens,
  }
}
