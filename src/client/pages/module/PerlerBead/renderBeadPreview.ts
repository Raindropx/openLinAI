import type { CellResult, GridSize } from './types'

// Keep the sprite cache bounded even for photographs containing thousands of colors.
const sprites = new Map<string, HTMLCanvasElement>()
const BOARD_COLOR = '#eee5d6'

function cacheSprite(key: string, canvas: HTMLCanvasElement) {
  if (sprites.size >= 256) sprites.delete(sprites.keys().next().value!)
  sprites.set(key, canvas)
  return canvas
}

function getPegSprite(size: number) {
  const key = `${size}:peg`
  const cached = sprites.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size * 0.5
  const topY = size * 0.47
  const bottomY = size * 0.53
  const radius = size * 0.072

  // The cap sits above the base; the side and cast shadow make the peg protrude.
  const shadow = ctx.createRadialGradient(cx + size * 0.025, bottomY + size * 0.025, 0,
    cx + size * 0.025, bottomY + size * 0.025, size * 0.13)
  shadow.addColorStop(0, 'rgba(92,68,36,0.32)')
  shadow.addColorStop(1, 'rgba(92,68,36,0)')
  ctx.fillStyle = shadow
  ctx.fillRect(cx - size * 0.14, topY - size * 0.1, size * 0.3, size * 0.3)

  ctx.beginPath()
  ctx.moveTo(cx - radius, topY)
  ctx.lineTo(cx - radius, bottomY)
  ctx.ellipse(cx, bottomY, radius, radius * 0.65, 0, Math.PI, 0, true)
  ctx.lineTo(cx + radius, topY)
  ctx.closePath()
  const side = ctx.createLinearGradient(cx - radius, 0, cx + radius, 0)
  side.addColorStop(0, '#d7c8ad')
  side.addColorStop(0.4, '#e7dac3')
  side.addColorStop(1, '#ae9873')
  ctx.fillStyle = side
  ctx.fill()
  ctx.strokeStyle = 'rgba(123,101,64,0.35)'
  ctx.lineWidth = size * 0.012
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(cx, topY, radius, radius * 0.65, 0, 0, Math.PI * 2)
  const cap = ctx.createLinearGradient(cx - radius, topY - radius, cx + radius, topY + radius)
  cap.addColorStop(0, '#fffaf0')
  cap.addColorStop(1, '#e1d1b4')
  ctx.fillStyle = cap
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.stroke()
  return cacheSprite(key, canvas)
}

function getBeadSprite(color: string, size: number) {
  const key = `${size}:${color}`
  const cached = sprites.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const center = size / 2
  const radius = size * 0.445
  const hole = size * 0.115

  // An actual opening preserves the board below, or transparency without a board.
  ctx.beginPath()
  ctx.arc(center, center, radius, 0, Math.PI * 2)
  ctx.moveTo(center + hole, center)
  ctx.arc(center, center, hole, 0, Math.PI * 2, true)
  ctx.fillStyle = color
  ctx.fill('evenodd')
  ctx.save()
  ctx.clip('evenodd')
  const light = ctx.createLinearGradient(0, 0, size, size)
  light.addColorStop(0, 'rgba(255,255,255,0.38)')
  light.addColorStop(0.45, 'rgba(255,255,255,0)')
  light.addColorStop(1, 'rgba(0,0,0,0.18)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, size, size)
  ctx.restore()

  ctx.lineWidth = size * 0.025
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(center, center, radius - size * 0.035, Math.PI * 1.08, Math.PI * 1.85)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.stroke()

  return cacheSprite(key, canvas)
}

/** Shared by the interactive canvas and PNG export; no selection or view controls. */
export function renderBeadPreview(
  ctx: CanvasRenderingContext2D,
  cells: CellResult[][],
  grid: GridSize,
  bounds: { x: number; y: number; width: number; height: number },
  showPegboard: boolean,
) {
  const { x, y, width, height } = bounds
  if (grid.columns <= 0 || grid.rows <= 0 || width <= 0 || height <= 0) return
  const cellW = width / grid.columns
  const cellH = height / grid.rows
  const pitch = Math.min(cellW, cellH)
  const transform = ctx.getTransform()
  const scale = Math.hypot(transform.a, transform.b)
  const spriteSize = Math.max(8, Math.min(128, Math.ceil(pitch * scale)))

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, width, height)
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  if (showPegboard) {
    ctx.fillStyle = BOARD_COLOR
    ctx.fillRect(x, y, width, height)
    const peg = getPegSprite(spriteSize)
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.columns; col++) {
        const cx = x + (col + 0.5) * cellW
        const cy = y + (row + 0.5) * cellH
        ctx.drawImage(peg, cx - pitch / 2, cy - pitch / 2, pitch, pitch)
      }
    }
  }
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) {
      const cell = cells[row]?.[col]
      if (!cell || cell.transparent) continue
      ctx.drawImage(getBeadSprite(cell.color, spriteSize),
        x + (col + 0.5) * cellW - pitch / 2,
        y + (row + 0.5) * cellH - pitch / 2, pitch, pitch)
    }
  }
  ctx.restore()
}
