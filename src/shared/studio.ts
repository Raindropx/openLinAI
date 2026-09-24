import type { TaskTemplate } from '../server/common/template-manager'
import type { GenerationMetadataInput } from '../server/module/gpt-image/generation-metadata'
import type { NovelAIGenerationSnapshot } from './studio-generation'
import type { CivitaiGenerationSnapshot } from './civitai-generation'

export interface StudioProvenance {
  origin: 'photopea' | 'novelai' | 'civitai' | 'import' | 'other'
  photopea?: 'created' | 'edited'
  sourceTaskId?: string
  model?: string
  endpointName?: string
  template?: TaskTemplate
  /** Provider adapters supply the actual generation snapshot when implemented. */
  generation?: GenerationMetadataInput
  /** Original embedded generation fields, retained when Photopea rewrites pixels. */
  sourceMetadata?: Record<string, string>
  novelai?: NovelAIGenerationSnapshot
  civitai?: CivitaiGenerationSnapshot
  inpaintRaw?: boolean
}

export interface StudioItem {
  id: string
  name: string
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'psd'
  bytes: number
  createdAt: number
  pinned: boolean
  provenance: StudioProvenance
  archivedTaskId?: string
}

export const STUDIO_MAX_FILE_BYTES = 64 * 1024 * 1024

export function studioSourceLabel(source: StudioProvenance) {
  const origin = {
    novelai: 'NovelAI',
    civitai: 'Civitai',
    photopea: 'Photopea',
    import: '导入素材',
    other: '生成图片',
  }[source.origin]
  if (source.photopea === 'created') return 'Photopea 创建'
  if (source.photopea === 'edited') {
    return source.origin === 'novelai' || source.origin === 'civitai'
      ? `${origin} · Photopea 已编辑`
      : 'Photopea 已编辑'
  }
  if (source.inpaintRaw) return `${origin} · 上游原始结果`
  return origin
}

export function studioFileUrl(id: string) {
  return `/api/studio/items/${encodeURIComponent(id)}/file`
}
