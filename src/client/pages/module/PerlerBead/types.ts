export type SourceImage = HTMLImageElement | HTMLCanvasElement

export function getSourceImageSize(image: SourceImage) {
  return {
    width: ('naturalWidth' in image && image.naturalWidth) || image.width,
    height: ('naturalHeight' in image && image.naturalHeight) || image.height,
  }
}

export interface GridSize {
  columns: number
  rows: number
}

export interface ColorRule {
  type: 'center' | 'dominant'
  offsetX: number // 0 ~ 1，默认 0.5，精度 0.01
  offsetY: number // 0 ~ 1，默认 0.5，精度 0.01
  maxColors?: number
}

export interface CellColor {
  color: string // #RRGGBB
  count: number
  ratio: number // 0 ~ 1
}

export interface CellResult {
  row: number
  column: number
  color: string
  beadCode?: string
  sourceColors: CellColor[]
}

export type BeadPaletteId = 'mard221' | 'mard291' | 'coco' | 'manman' | 'panpan' | 'mixiaowo'
export type BeadMatchAlgorithm = 'oklab' | 'ciede2000' | 'rgb'
export interface BeadConversion {
  paletteId: BeadPaletteId
  algorithm: BeadMatchAlgorithm
}

export interface CellOverride {
  color?: string
  rule?: ColorRule
}

export type CellOverrideMap = Record<string, CellOverride>

export interface AutoGridResult {
  gridSize: GridSize
  confidence: number
}
