import { Button, InputNumber, message, Modal, Radio, Tooltip } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../../../i18n'
import type { ColorReductionOptions } from '../colorReduction'

interface SourceImageActionsProps {
  disabled: boolean
  comparing: boolean
  onCompare: (active: boolean) => void
  onRestore: () => void
  getImageData: () => ImageData
  onReduced: (data: ImageData, palette: readonly string[]) => void | Promise<void>
}

export function SourceImageActions({ disabled, comparing, onCompare, onRestore, getImageData, onReduced }: SourceImageActionsProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ColorReductionOptions['mode']>('count')
  const [count, setCount] = useState<number | null>(128)
  const [threshold, setThreshold] = useState<number | null>(12)
  const [busy, setBusy] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const value = mode === 'count' ? count : threshold
  const valid = value !== null && Number.isFinite(value) && (mode === 'count' ? Number.isInteger(value) && value >= 1 && value <= 256 : value >= 0 && value <= 442)

  useEffect(() => () => { workerRef.current?.terminate() }, [])
  useEffect(() => {
    if (!comparing) return
    const end = () => onCompare(false)
    const visibility = () => { if (document.hidden) end() }
    window.addEventListener('blur', end)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('blur', end); document.removeEventListener('visibilitychange', visibility) }
  }, [comparing, onCompare])

  const reduce = () => {
    if (!valid || value === null || busy || disabled) return
    try {
      const image = getImageData()
      const worker = new Worker(new URL('../colorReduction.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      setBusy(true)
      const finish = () => { worker.terminate(); workerRef.current = null; setBusy(false) }
      worker.onerror = () => { finish(); message.error(t('减少颜色失败，请重试')) }
      worker.onmessage = async (event: MessageEvent<{ data: Uint8ClampedArray; before: number; after: number; palette: string[]; error?: string }>) => {
        try {
          if (event.data.error) throw new Error(t('减少颜色失败，请重试'))
          const { data, before, after, palette } = event.data
          await onReduced(new ImageData(new Uint8ClampedArray(data), image.width, image.height), palette)
          message.success(t('颜色数量：{0} → {1}', [before, after]))
          setOpen(false)
        } catch (error) { message.error(error instanceof Error ? error.message : t('减少颜色失败，请重试')) }
        finally { finish() }
      }
      worker.postMessage({ data: image.data, options: { mode, value } }, [image.data.buffer])
    } catch (error) {
      workerRef.current?.terminate()
      workerRef.current = null
      setBusy(false)
      message.error(error instanceof Error ? error.message : t('减少颜色失败，请重试'))
    }
  }

  return <>
    <Tooltip title={t('按住查看刚载入的原图，松开返回当前图片')}>
      <Button size="small" disabled={disabled} aria-pressed={comparing} className="touch-none select-none"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          onCompare(true)
        }}
        onPointerUp={() => onCompare(false)} onPointerCancel={() => onCompare(false)} onLostPointerCapture={() => onCompare(false)}
        onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onCompare(true) } }}
        onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onCompare(false) } }}
        onBlur={() => onCompare(false)}>{t('原图对照')}</Button>
    </Tooltip>
    <Button size="small" disabled={disabled || comparing} onClick={() => {
      try { onRestore() } catch (error) { message.error(error instanceof Error ? error.message : t('图片编辑失败')) }
    }}>{t('恢复原图')}</Button>
    <Button size="small" disabled={disabled || comparing} onClick={() => setOpen(true)}>{t('减少颜色')}</Button>
    <Modal title={t('减少颜色')} open={open} onCancel={() => { if (!busy) setOpen(false) }} onOk={reduce}
      confirmLoading={busy} okText={t('应用')} cancelText={t('取消')} okButtonProps={{ disabled: !valid || disabled }}
      cancelButtonProps={{ disabled: busy }} closable={!busy} mask={{ closable: !busy }} keyboard={!busy}>
      <Radio.Group value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)} className="mb-4">
        <Radio.Button value="count">{t('指定颜色数量')}</Radio.Button>
        <Radio.Button value="threshold">{t('自动优化')}</Radio.Button>
      </Radio.Group>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={mode === 'count' ? 'perler-color-count' : 'perler-color-threshold'}>{mode === 'count' ? t('目标颜色数') : t('颜色合并阈值')}</label>
        <InputNumber id={mode === 'count' ? 'perler-color-count' : 'perler-color-threshold'} value={value} disabled={busy}
          min={mode === 'count' ? 1 : 0} max={mode === 'count' ? 256 : 442} precision={mode === 'count' ? 0 : 1}
          onChange={mode === 'count' ? setCount : setThreshold} />
        {mode === 'count' && <>{[128, 64, 32, 16].map((size) => <Button key={size} size="small" disabled={busy} onClick={() => setCount(size)}>{size}</Button>)}</>}
      </div>
      <p className="mt-3 text-xs text-slate-500">{mode === 'count'
        ? t('将当前图片缩减至不超过指定数量的颜色；原有颜色更少时保持不变。')
        : t('阈值使用 RGB 色差（0–442），越大合并越多；0 保持原色。相近颜色归并到出现最多的代表色，不进行连锁合并。')}</p>
      <p className="text-xs text-slate-500">{t('处理当前图片，保留尺寸和透明度；应用后可撤销，也可恢复刚载入的原图。')}</p>
      <p className="text-xs text-slate-500">{t('拼豆预览、用量清单和导出沿用减色后的调色板，缩放、透明边缘和单格取色不会增加颜色。')}</p>
    </Modal>
  </>
}
