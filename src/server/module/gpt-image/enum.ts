export const GPT_IMAGE_SOURCE_MODEL = 'gpt-image-2'

export type GptImageSize = '1k' | '2k' | '4k'

export type GptImageQuality = 'medium' | 'high'

/** omit 不发送参数；未设置时文生图与参考图编辑均使用 low。 */
export type GptImageModeration = 'auto' | 'low' | 'omit'

export const GPT_IMAGE_OUTPUT_MAX_N = 8
