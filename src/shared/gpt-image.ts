import { usesLaoZhangImages } from './laozhang'

/** 仅按模型 ID 匹配，供审核选项与请求传参使用；不代表服务商支持该参数。 */
export function isGptImageModel(model: string | undefined): boolean {
  return /gpt/i.test(model || '')
}

/** APImart 文档明确声明 moderation 的线路；普通/Ext 线路不套用此参数。 */
export function isAPIMartModerationModel(model: string | undefined): boolean {
  return /^(?:gpt-image-(?:1(?:\.5)?|2)-official|gpt-image-2\.5-(?:flare|sunburst))$/i.test(
    model || '',
  )
}

export function showGptImageModeration(endpoint: {
  baseURL: string
  engine?: string
  model: string
  editModel?: string
}): boolean {
  const models = [endpoint.model, endpoint.editModel]
  if (endpoint.engine === 'apimart-images')
    return models.some(isAPIMartModerationModel)
  return (
    (!endpoint.engine ||
      endpoint.engine === 'openai-images' ||
      usesLaoZhangImages(endpoint)) &&
    models.some(isGptImageModel)
  )
}
