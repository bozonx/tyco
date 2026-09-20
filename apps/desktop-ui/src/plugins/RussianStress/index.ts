import { PluginContext } from '../../types/plugins'

const makeRusStress = (text: string): string => {
  // Словарь соответствия обычных гласных и гласных с ударением
  const stressMap: Record<string, string> = {
    а: 'а́',
    е: 'е́',
    и: 'и́',
    о: 'о́',
    у: 'у́',
    ы: 'ы́',
    э: 'э́',
    ю: 'ю́',
    я: 'я́',
    А: 'А́',
    Е: 'Е́',
    И: 'И́',
    О: 'О́',
    У: 'У́',
    Ы: 'Ы́',
    Э: 'Э́',
    Ю: 'Ю́',
    Я: 'Я́',
  }

  // Заменяем каждую гласную на соответствующую ей букву с ударением,
  // пропуская буквы, которые уже имеют ударение
  return text.replace(/[аеиоуыэюяАЕИОУЫЭЮЯ]/g, (match) => {
    // Проверяем, есть ли после текущей буквы символ ударения
    const nextChar = text.charAt(text.indexOf(match) + 1)
    if (nextChar === '́') {
      return match // Пропускаем букву, если у неё уже есть ударение
    }
    return stressMap[match] || match
  })
}

export default function pluginIndex() {
  return {
    name: 'Russian Stress',
    labelKey: 'plugin.russianStress.label',
    init: (ctx: PluginContext) => {
      ctx.registerEditItems([
        {
          labelKey: 'plugin.russianStress.label',
          action: async (text: string) => {
            return makeRusStress(text)
          },
        },
      ])
    },
  }
}
