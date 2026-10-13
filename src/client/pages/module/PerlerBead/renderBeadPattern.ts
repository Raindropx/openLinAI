import { t } from '../../../i18n'
import { BEAD_PALETTE_NAMES, getBeadStats } from './beadPalette'
import { hexToRgb } from './processing'
import type { BeadConversion, CellResult, GridSize } from './types'

const FONT = 'Arial, "Microsoft YaHei", sans-serif'
const PADDING = 24
const HEADER = 132
const LEGEND_HEIGHT = 36
const LEGEND_GAP = 8

/** Pick the stronger contrast against the actual printed cell color. */
export function getPatternTextColor(color: string) {
  const rgb = hexToRgb(color)
  if (!rgb) return '#111111'
  const linear = (value: number) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.0556 ? '#FFFFFF' : '#111111'
}

export function getBeadPatternLayout(grid: GridSize, colorCount: number) {
  // A readable minimum also supports the largest (200 x 200) grids.
  const cellSize = Math.max(36, Math.min(48, Math.floor(1440 / Math.max(grid.columns, grid.rows))))
  const width = Math.max(640, (grid.columns + 2) * cellSize + PADDING * 2)
  const legendColumns = Math.max(1, Math.floor((width - PADDING * 2 + LEGEND_GAP) / (144 + LEGEND_GAP)))
  const legendRows = Math.ceil(colorCount / legendColumns)
  const legendY = HEADER + (grid.rows + 2) * cellSize + 24
  return {
    width,
    height: legendY + legendRows * (LEGEND_HEIGHT + LEGEND_GAP) + PADDING,
    cellSize,
    gridX: Math.round((width - grid.columns * cellSize) / 2),
    gridY: HEADER + cellSize,
    legendY,
    legendColumns,
    legendWidth: (width - PADDING * 2 - (legendColumns - 1) * LEGEND_GAP) / legendColumns,
  }
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxWidth: number, bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`
  const measured = ctx.measureText(text).width
  if (measured > maxWidth) ctx.font = `${bold ? 'bold ' : ''}${size * maxWidth / measured}px ${FONT}`
  ctx.fillText(text, x, y)
}

/** Render the complete chart independently of preview mode, zoom, and selection. */
export function createBeadPatternCanvas(cells: CellResult[][], grid: GridSize, conversion: BeadConversion) {
  const stats = getBeadStats(cells)
  const total = stats.reduce((sum, item) => sum + item.count, 0)
  const layout = getBeadPatternLayout(grid, stats.length)
  const { width, height, cellSize, gridX, gridY, legendY, legendColumns, legendWidth } = layout
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context unavailable')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#111111'
  drawText(ctx, t('拼豆图纸 / {0}', [t(BEAD_PALETTE_NAMES[conversion.paletteId])]), PADDING, 32, 28, width - PADDING * 2, true)
  drawText(ctx, t('{0} 列 × {1} 行 · {2} 颗 · {3} 种颜色', [grid.columns, grid.rows, total, stats.length]), PADDING, 70, 18, width - PADDING * 2)
  ctx.fillStyle = '#475569'
  drawText(ctx, t('无色号格不放豆；每 5 格加粗网格线。'), PADDING, 103, 15, width - PADDING * 2)

  const gridWidth = grid.columns * cellSize
  const gridHeight = grid.rows * cellSize
  ctx.fillStyle = '#EAF1F8'
  ctx.fillRect(gridX - cellSize, gridY - cellSize, gridWidth + cellSize * 2, cellSize)
  ctx.fillRect(gridX - cellSize, gridY + gridHeight, gridWidth + cellSize * 2, cellSize)
  ctx.fillRect(gridX - cellSize, gridY, cellSize, gridHeight)
  ctx.fillRect(gridX + gridWidth, gridY, cellSize, gridHeight)

  ctx.textAlign = 'center'
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const cell = cells[row]?.[column]
      const x = gridX + column * cellSize
      const y = gridY + row * cellSize
      ctx.fillStyle = cell?.color ?? '#FFFFFF'
      ctx.fillRect(x, y, cellSize, cellSize)
      // Thin borders remain visible on both light and dark fills.
      ctx.strokeStyle = getPatternTextColor(cell?.color ?? '#FFFFFF') === '#FFFFFF'
        ? 'rgba(255,255,255,0.32)' : 'rgba(15,23,42,0.18)'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1)
      if (cell && !cell.transparent && cell.beadCode) {
        ctx.fillStyle = getPatternTextColor(cell.color)
        drawText(ctx, cell.beadCode, x + cellSize / 2, y + cellSize / 2, 14, cellSize - 6)
      }
    }
  }

  // Every coordinate is printed twice, including three-digit coordinates.
  ctx.fillStyle = '#111111'
  for (let column = 0; column < grid.columns; column++) {
    const x = gridX + (column + 0.5) * cellSize
    for (const y of [gridY - cellSize / 2, gridY + gridHeight + cellSize / 2]) {
      drawText(ctx, String(column + 1), x, y, 18, cellSize - 4, true)
    }
  }
  for (let row = 0; row < grid.rows; row++) {
    const y = gridY + (row + 0.5) * cellSize
    for (const x of [gridX - cellSize / 2, gridX + gridWidth + cellSize / 2]) {
      drawText(ctx, String(row + 1), x, y, 18, cellSize - 4, true)
    }
  }

  // Stronger separators aid counting; include the full coordinate frame.
  const line = (x1: number, y1: number, x2: number, y2: number, strong: boolean) => {
    ctx.strokeStyle = strong ? '#64748B' : '#CBD5E1'
    ctx.lineWidth = strong ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  for (let column = 0; column <= grid.columns; column++) {
    const x = gridX + column * cellSize
    line(x, gridY - cellSize, x, gridY, false)
    line(x, gridY + gridHeight, x, gridY + gridHeight + cellSize, false)
    if (column % 5 === 0 || column === grid.columns) line(x, gridY, x, gridY + gridHeight, true)
  }
  for (let row = 0; row <= grid.rows; row++) {
    const y = gridY + row * cellSize
    line(gridX - cellSize, y, gridX, y, false)
    line(gridX + gridWidth, y, gridX + gridWidth + cellSize, y, false)
    if (row % 5 === 0 || row === grid.rows) line(gridX, y, gridX + gridWidth, y, true)
  }
  ctx.strokeStyle = '#94A3B8'
  ctx.lineWidth = 1
  ctx.strokeRect(gridX - cellSize, gridY - cellSize, gridWidth + cellSize * 2, gridHeight + cellSize * 2)

  // Include every used code and its count, wrapping into as many rows as needed.
  stats.forEach((item, index) => {
    const x = PADDING + (index % legendColumns) * (legendWidth + LEGEND_GAP)
    const y = legendY + Math.floor(index / legendColumns) * (LEGEND_HEIGHT + LEGEND_GAP)
    ctx.fillStyle = item.color
    ctx.fillRect(x, y, legendWidth, LEGEND_HEIGHT)
    ctx.strokeStyle = '#CBD5E1'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, legendWidth - 1, LEGEND_HEIGHT - 1)
    ctx.fillStyle = getPatternTextColor(item.color)
    drawText(ctx, `${item.code} (${item.count})`, x + legendWidth / 2, y + LEGEND_HEIGHT / 2, 15, legendWidth - 12, true)
  })
  return canvas
}
