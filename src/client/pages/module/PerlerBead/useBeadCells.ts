import { useEffect, useMemo, useState } from 'react'
import type { BeadConversion, CellResult } from './types'

type Mapping = Array<[string, { code: string; hex: string }]>
interface ResolvedConversion {
  baseline: CellResult[][]
  conversion: BeadConversion
  mapping: Mapping
}

/** Worker isolation keeps full CIEDE2000 comparisons responsive even at 200 × 200 cells. */
export function useBeadCells(baseline: CellResult[][] | null, conversion: BeadConversion | null, onError: () => void) {
  const [resolved, setResolved] = useState<ResolvedConversion | null>(null)
  const ready = !!baseline && !!conversion && resolved?.baseline === baseline && resolved.conversion === conversion

  useEffect(() => {
    if (!baseline || !conversion) { setResolved(null); return }
    let disposed = false
    let worker: Worker | undefined
    const fail = () => { if (!disposed) onError(); worker?.terminate() }
    try {
      worker = new Worker(new URL('./beadPalette.worker.ts', import.meta.url), { type: 'module' })
      worker.onerror = fail
      worker.onmessage = (event: MessageEvent<{ mapping?: Mapping; error?: boolean }>) => {
        if (disposed) return
        if (event.data.error || !event.data.mapping) { fail(); return }
        setResolved({ baseline, conversion, mapping: event.data.mapping })
        worker?.terminate()
      }
      const colors = [...new Set(baseline.flat().map((cell) => cell.color))]
      worker.postMessage({ colors, conversion })
    } catch { fail() }
    return () => { disposed = true; worker?.terminate() }
  }, [baseline, conversion, onError])

  const cells = useMemo(() => {
    if (!baseline || !ready || !resolved) return baseline
    const mapping = new Map(resolved.mapping)
    return baseline.map((row) => row.map((cell) => {
      const bead = mapping.get(cell.color)!
      return { ...cell, color: bead.hex, beadCode: bead.code }
    }))
  }, [baseline, ready, resolved])

  return { cells, converting: !!baseline && !!conversion && !ready }
}
