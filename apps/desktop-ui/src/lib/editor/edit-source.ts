/**
 * Откуда пришла программная правка документа. Источник попадает в транзакцию
 * CodeMirror как `userEvent` и решает, склеивать ли правку с соседними в
 * истории отмены
 */
export type EditSource = 'plain' | 'ai' | 'voice' | 'paste'

/**
 * Значения `userEvent` для транзакций — по ним правку можно узнать в логах и в
 * тестах
 */
export const EDIT_USER_EVENT: Record<EditSource, string> = {
  plain: 'tyco.store',
  ai: 'tyco.ai',
  voice: 'tyco.voice',
  paste: 'input.paste',
}

/**
 * Источники, которые должны быть отдельным шагом Ctrl+Z: результат
 * AI-преобразования или распознанная речь не склеиваются с ручным вводом
 */
export const isolatedEditSources: ReadonlySet<EditSource> = new Set<EditSource>(
  ['ai', 'voice', 'paste']
)
