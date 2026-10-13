import { t } from '../../../i18n'
import { create } from 'zustand'
import { getDefaultGridSize } from './processing'
import { getConnectedColorRegion, getTransparencyKey, type TransparentCellOverrides } from './transparency'
import type {
  BeadConversion,
  CellOverride,
  CellOverrideMap,
  CellResult,
  ColorRule,
  GridSize,
} from './types'

interface PerlerBeadState {
  imageUrl: string | null
  imageElement: HTMLImageElement | null
  imageData: ImageData | null
  gridSize: GridSize
  globalRule: ColorRule
  cellOverrides: CellOverrideMap
  transparentColorKeys: string[]
  transparentCellOverrides: TransparentCellOverrides
  toggleTransparentColor: (key: string, transparent?: boolean) => void
  toggleTransparentRegion: (cells: CellResult[][], row: number, column: number) => void
  selectedCell: { row: number; column: number } | null
  isDetecting: boolean
  loadingImage: boolean
  sourceHistory: string[]
  sourceHistoryIndex: number
  originalSource: { url: string; image: HTMLImageElement; data: ImageData } | null
  sourcePalette: readonly string[] | null
  beadConversion: BeadConversion | null
  beadConversionHistory: (BeadConversion | null)[]
  beadPreview: boolean
  showPegboard: boolean
  setBeadPreview: (enabled: boolean) => void
  setShowPegboard: (enabled: boolean) => void
  applyBeadConversion: (conversion: BeadConversion) => void
  undoBeadConversion: () => void
  commitEditedImage: (url: string, img: HTMLImageElement, data: ImageData, palette?: readonly string[] | null) => void
  restoreSourceImage: (index: number, img: HTMLImageElement, data: ImageData) => void

  // Actions
  setImage: (
    url: string,
    img: HTMLImageElement,
    data: ImageData,
    detectedGrid?: GridSize,
  ) => void
  setGridSize: (size: GridSize) => void
  setGlobalRule: (rule: ColorRule) => void
  setCellOverride: (
    row: number,
    col: number,
    override: CellOverride | null,
  ) => void
  clearAllOverrides: () => void
  setSelectedCell: (cell: { row: number; column: number } | null) => void
  setIsDetecting: (isDetecting: boolean) => void
  setLoadingImage: (loading: boolean) => void
  reset: () => void
}

const MAX_SOURCE_HISTORY = 10
const sourcePalettes = new Map<string, readonly string[]>()
function releaseSources(urls: string[], retained: string[] = []) {
  const keep = new Set(retained)
  for (const url of new Set(urls)) if (!keep.has(url)) {
    sourcePalettes.delete(url)
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
}

export const usePerlerBeadStore = create<PerlerBeadState>((set, get) => ({
  imageUrl: null,
  imageElement: null,
  imageData: null,
  gridSize: { columns: 50, rows: 50 },
  globalRule: { type: 'dominant', offsetX: 0.5, offsetY: 0.5 },
  cellOverrides: {},
  transparentColorKeys: [],
  transparentCellOverrides: {},
  toggleTransparentColor: (key, transparent) => set((state) => {
    const hidden = transparent ?? !state.transparentColorKeys.includes(key)
    const keys = state.transparentColorKeys.filter((entry) => entry !== key)
    const overrides = { ...state.transparentCellOverrides }
    delete overrides[key]
    return { transparentColorKeys: hidden ? [...keys, key] : keys, transparentCellOverrides: overrides }
  }),
  toggleTransparentRegion: (cells, row, column) => set((state) => {
    const selected = cells[row]?.[column]
    if (!selected) return state
    const key = getTransparencyKey(selected, state.beadConversion)
    const overrides = { ...state.transparentCellOverrides[key] }
    const hidden = !selected.transparent
    const globallyHidden = state.transparentColorKeys.includes(key)
    for (const cell of getConnectedColorRegion(cells, row, column, state.beadConversion)) {
      const position = `${cell.row},${cell.column}`
      if (hidden === globallyHidden) delete overrides[position]
      else overrides[position] = hidden
    }
    const next = { ...state.transparentCellOverrides }
    if (Object.keys(overrides).length) next[key] = overrides
    else delete next[key]
    return { transparentCellOverrides: next }
  }),
  selectedCell: null,
  isDetecting: false,
  loadingImage: false,
  sourceHistory: [],
  sourceHistoryIndex: -1,
  originalSource: null,
  sourcePalette: null,
  beadConversion: null,
  beadConversionHistory: [],
  beadPreview: false,
  showPegboard: true,
  setBeadPreview: (beadPreview) => set({ beadPreview }),
  setShowPegboard: (showPegboard) => set({ showPegboard }),

  applyBeadConversion: (conversion) => {
    const state = get()
    if (!state.imageData || state.loadingImage) return
    if (state.beadConversion?.paletteId === conversion.paletteId && state.beadConversion.algorithm === conversion.algorithm) return
    set({ beadConversion: { ...conversion }, beadConversionHistory: [...state.beadConversionHistory, state.beadConversion] })
  },
  undoBeadConversion: () => {
    const { beadConversionHistory } = get()
    if (!beadConversionHistory.length) return
    set({ beadConversion: beadConversionHistory[beadConversionHistory.length - 1], beadConversionHistory: beadConversionHistory.slice(0, -1) })
  },

  setImage: (url, img, data, detectedGrid) => {
    releaseSources([...get().sourceHistory, get().originalSource?.url ?? ''], [url])
    sourcePalettes.delete(url)

    const initialGrid =
      detectedGrid ||
      getDefaultGridSize(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
      )

    set({
      imageUrl: url,
      imageElement: img,
      imageData: data,
      gridSize: initialGrid,
      selectedCell: null,
      cellOverrides: {},
      transparentColorKeys: [],
      transparentCellOverrides: {},
      loadingImage: false,
      sourceHistory: [url],
      sourceHistoryIndex: 0,
      originalSource: { url, image: img, data },
      sourcePalette: null,
      beadConversion: null,
      beadConversionHistory: [],
    })
  },

  commitEditedImage: (url, img, data, palette) => {
    const previous = get()
    const history = [...previous.sourceHistory.slice(0, previous.sourceHistoryIndex + 1), url].slice(-MAX_SOURCE_HISTORY)
    releaseSources(previous.sourceHistory, [...history, previous.originalSource?.url ?? ''])
    if (palette?.length) sourcePalettes.set(url, [...palette])
    else sourcePalettes.delete(url)
    set({ imageUrl: url, imageElement: img, imageData: data, sourcePalette: sourcePalettes.get(url) ?? null, sourceHistory: history, sourceHistoryIndex: history.length - 1, loadingImage: false })
  },

  restoreSourceImage: (index, img, data) => {
    const url = get().sourceHistory[index]
    if (!url) throw new Error(t('原图编辑历史已变化，请重试'))
    set({ imageUrl: url, imageElement: img, imageData: data, sourcePalette: sourcePalettes.get(url) ?? null, sourceHistoryIndex: index, loadingImage: false })
  },

  setGridSize: (size) => {
    const { cellOverrides, selectedCell, transparentCellOverrides } = get()
    const nextTransparency: TransparentCellOverrides = {}
    for (const [key, overrides] of Object.entries(transparentCellOverrides)) {
      const remaining = Object.fromEntries(Object.entries(overrides).filter(([position]) => {
        const [row, column] = position.split(',').map(Number)
        return row < size.rows && column < size.columns
      }))
      if (Object.keys(remaining).length) nextTransparency[key] = remaining
    }
    const nextOverrides: CellOverrideMap = {}
    for (const [key, val] of Object.entries(cellOverrides)) {
      const [rStr, cStr] = key.split(',')
      const r = parseInt(rStr, 10)
      const c = parseInt(cStr, 10)
      if (r < size.rows && c < size.columns) {
        nextOverrides[key] = val
      }
    }

    let nextSelected = selectedCell
    if (
      selectedCell &&
      (selectedCell.row >= size.rows || selectedCell.column >= size.columns)
    ) {
      nextSelected = null
    }

    set({
      gridSize: size,
      cellOverrides: nextOverrides,
      transparentCellOverrides: nextTransparency,
      selectedCell: nextSelected,
    })
  },

  setGlobalRule: (rule) => set({ globalRule: rule }),

  setCellOverride: (row, col, override) => {
    const key = `${row},${col}`
    const nextOverrides = { ...get().cellOverrides }
    if (override === null) {
      delete nextOverrides[key]
    } else {
      nextOverrides[key] = override
    }
    set({ cellOverrides: nextOverrides })
  },

  clearAllOverrides: () => set({ cellOverrides: {} }),

  setSelectedCell: (cell) => set({ selectedCell: cell }),

  setIsDetecting: (isDetecting) => set({ isDetecting }),

  setLoadingImage: (loadingImage) => set({ loadingImage }),

  reset: () => {
    releaseSources([...get().sourceHistory, get().originalSource?.url ?? ''])

    set({
      imageUrl: null,
      imageElement: null,
      imageData: null,
      gridSize: { columns: 50, rows: 50 },
      globalRule: { type: 'dominant', offsetX: 0.5, offsetY: 0.5 },
      cellOverrides: {},
      transparentColorKeys: [],
      transparentCellOverrides: {},
      selectedCell: null,
      isDetecting: false,
      loadingImage: false,
      sourceHistory: [],
      sourceHistoryIndex: -1,
      originalSource: null,
      sourcePalette: null,
      beadConversion: null,
      beadConversionHistory: [],
    })
  },
}))
