export type ColorReductionOptions = { mode: 'count' | 'threshold'; value: number }

interface Color {
  key: number
  rgb: number[]
  count: number
}

const channels = (key: number) => [key >>> 16, (key >>> 8) & 255, key & 255]
const distance = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0)

// Split along weighted color variance, minimizing the combined error of the two new boxes.
function reduceByCount(colors: Color[], limit: number) {
  const makeBox = (items: Color[]) => {
    const sum = [0, 0, 0], squares = [0, 0, 0]
    let weight = 0
    for (const color of items) {
      weight += color.count
      for (let i = 0; i < 3; i++) {
        sum[i] += color.rgb[i] * color.count
        squares[i] += color.rgb[i] ** 2 * color.count
      }
    }
    const variance = squares.map((value, i) => value - sum[i] ** 2 / weight)
    const axis = variance.indexOf(Math.max(...variance))
    return { items, weight, axis, sum, squares, score: variance.reduce((a, b) => a + b, 0) }
  }
  const boxes = [makeBox(colors)]
  while (boxes.length < limit) {
    let index = -1
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].items.length > 1 && (index < 0 || boxes[i].score > boxes[index].score)) index = i
    }
    if (index < 0) break
    const box = boxes[index]
    box.items.sort((a, b) => a.rgb[box.axis] - b.rgb[box.axis] || a.key - b.key)
    let weight = 0, split = 1, best = Infinity
    const sum = [0, 0, 0], squares = [0, 0, 0]
    for (let i = 0; i < box.items.length - 1; i++) {
      const color = box.items[i]
      weight += color.count
      for (let channel = 0; channel < 3; channel++) {
        sum[channel] += color.rgb[channel] * color.count
        squares[channel] += color.rgb[channel] ** 2 * color.count
      }
      if (color.rgb[box.axis] === box.items[i + 1].rgb[box.axis]) continue
      let error = 0
      for (let channel = 0; channel < 3; channel++) {
        error += squares[channel] - sum[channel] ** 2 / weight
          + box.squares[channel] - squares[channel] - (box.sum[channel] - sum[channel]) ** 2 / (box.weight - weight)
      }
      if (error < best) { best = error; split = i + 1 }
    }
    boxes.splice(index, 1, makeBox(box.items.slice(0, split)), makeBox(box.items.slice(split)))
  }
  const mapping = new Map<number, number>()
  for (const box of boxes) {
    const mean = [0, 0, 0]
    for (const color of box.items) for (let i = 0; i < 3; i++) mean[i] += color.rgb[i] * color.count / box.weight
    let representative = box.items[0]
    for (const color of box.items) {
      if (distance(color.rgb, mean) < distance(representative.rgb, mean)) representative = color
    }
    for (const color of box.items) mapping.set(color.key, representative.key)
  }
  return mapping
}

// Match each color directly to a fixed representative; avoid chains that merge visibly different colors.
function reduceByThreshold(colors: Color[], threshold: number) {
  const mapping = new Map<number, number>()
  const buckets = new Map<string, Color[]>()
  colors.sort((a, b) => b.count - a.count) // Stable ties keep the first color encountered in the image.
  for (const color of colors) {
    const bin = color.rgb.map((value) => Math.floor(value / threshold))
    let match: Color | undefined, best = threshold ** 2
    for (let r = -1; r <= 1; r++) for (let g = -1; g <= 1; g++) for (let b = -1; b <= 1; b++) {
      for (const candidate of buckets.get(`${bin[0] + r},${bin[1] + g},${bin[2] + b}`) ?? []) {
        const delta = distance(color.rgb, candidate.rgb)
        if (delta <= best && (!match || delta < best || candidate.count > match.count)) {
          match = candidate
          best = delta
        }
      }
    }
    mapping.set(color.key, match?.key ?? color.key)
    if (!match) {
      const key = bin.join(',')
      const bucket = buckets.get(key) ?? []
      bucket.push(color)
      buckets.set(key, bucket)
    }
  }
  return mapping
}

export function reduceImageColors(data: Uint8ClampedArray, options: ColorReductionOptions) {
  if (!Number.isFinite(options.value) || (options.mode === 'count'
    ? !Number.isInteger(options.value) || options.value < 1 || options.value > 256
    : options.value < 0 || options.value > 442)) throw new Error('Invalid color reduction value')
  const histogram = new Map<number, number>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    histogram.set(key, (histogram.get(key) ?? 0) + 1)
  }
  const before = histogram.size
  if ((options.mode === 'count' && before <= options.value) || (options.mode === 'threshold' && options.value === 0)) {
    return { data, before, after: before }
  }
  const colors = [...histogram].map(([key, count]) => ({ key, count, rgb: channels(key) }))
  const mapping = options.mode === 'count' ? reduceByCount(colors, options.value) : reduceByThreshold(colors, options.value)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const key = mapping.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])!
    data[i] = key >>> 16
    data[i + 1] = (key >>> 8) & 255
    data[i + 2] = key & 255
  }
  return { data, before, after: new Set(mapping.values()).size }
}

/** The bead chart is opaque on white. Quantize that visible palette too when alpha creates extra shades. */
export function getBeadPalette(data: Uint8ClampedArray, options: ColorReductionOptions) {
  let translucent = false
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { translucent = true; break }
  const visible = translucent ? data.slice() : data
  if (translucent) {
    for (let i = 0; i < visible.length; i += 4) {
      const alpha = visible[i + 3] / 255
      for (let channel = 0; channel < 3; channel++) visible[i + channel] = Math.round(visible[i + channel] * alpha + 255 * (1 - alpha))
      visible[i + 3] = 255
    }
    reduceImageColors(visible, options)
  }
  const palette = new Set<number>()
  for (let i = 0; i < visible.length; i += 4) {
    const key = (visible[i] << 16) | (visible[i + 1] << 8) | visible[i + 2]
    palette.add(key)
  }
  return [...palette].map((key) => `#${key.toString(16).padStart(6, '0').toUpperCase()}`)
}
