import { GoogleGenAI } from '@google/genai'
import { logger } from '../utils/logger'

export class GeminiManager {
  private static instance: GeminiManager
  /** GoogleGenAI client 缓存，按 apiKey 复用 */
  private clientCache = new Map<string, GoogleGenAI>()

  private constructor() {}

  public static getInstance(): GeminiManager {
    if (!GeminiManager.instance) {
      GeminiManager.instance = new GeminiManager()
    }
    return GeminiManager.instance
  }

  private getClient(apiKey: string): GoogleGenAI {
    let client = this.clientCache.get(apiKey)
    if (!client) {
      client = new GoogleGenAI({ apiKey })
      this.clientCache.set(apiKey, client)
    }
    return client
  }

  public async generateImage(apiKey: string, prompt: string) {
    logger.info('Generating image with Gemini')
    try {
      const ai = this.getClient(apiKey)

      const response = await ai.models.generateImages({
        model: 'gemini-3.1-flash-image-preview',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
        },
      })

      if (response.generatedImages && response.generatedImages.length > 0) {
        const imageBase64 = response.generatedImages[0].image?.imageBytes
        if (!imageBase64) {
          throw new Error('No image bytes returned')
        }
        return {
          success: true,
          image: `data:image/jpeg;base64,${imageBase64}`,
        }
      }

      throw new Error('No image generated')
    } catch (error) {
      logger.error('Failed to generate image', JSON.stringify(error))
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export const geminiManager = GeminiManager.getInstance()
