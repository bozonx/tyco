import { AiError } from '@bozonx/ai-kit'
import {
  deeplTranslationProvider,
  type TranslationProviderFactory,
} from '@bozonx/ai-kit/translate'

/** A depleted subscription is permanent until the user changes its quota. */
export const createDeepLProvider: TranslationProviderFactory = (init) => ({
  async translate(request) {
    let quotaExhausted = false
    const provider = deeplTranslationProvider({
      ...init,
      fetch: async (input, options) => {
        if (!init.fetch) throw new Error('DeepL requires the desktop transport')
        const response = await init.fetch(input, options)
        quotaExhausted = response.status === 456
        return response
      },
    })
    try {
      return await provider.translate(request)
    } catch (error) {
      if (quotaExhausted)
        throw new AiError(
          'invalid_request',
          'DeepL translation quota is exhausted; increase the subscription limit before retrying',
          { provider: 'deepl', status: 456, cause: error }
        )
      throw error
    }
  },
})
