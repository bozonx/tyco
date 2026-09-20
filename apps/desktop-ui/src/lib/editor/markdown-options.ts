import type { Options as RemarkStringifyOptions } from 'remark-stringify'

/**
 * Единые настройки сериализации Markdown для всего приложения: и для кнопки
 * «привести markdown в порядок» (`useCodeFormatter.formatMdAndStyle`), и для
 * конвертации HTML из буфера обмена. Иначе в одном документе оказались бы
 * списки на `-` и на `*` одновременно
 */
export const MARKDOWN_STRINGIFY_OPTIONS: RemarkStringifyOptions = {
  bullet: '-',
}
