import { t, useAppLanguage } from '../../../i18n'
import { EditOutlined, RedoOutlined, UndoOutlined } from '@ant-design/icons'
import { Button, message, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { InlineImageEditor } from './components/InlineImageEditor'
import { GridPreview } from './components/GridPreview'
import { ImageSource } from './components/ImageSource'
import { ToolPanel } from './components/ToolPanel'
import {
  computeAllCells,
  detectGridSize,
  getDefaultGridSize,
  getImageDataFromImage,
  loadImage,
} from './processing'
import { usePerlerBeadStore } from './store'
import type { CellOverride, CellResult } from './types'

export function PerlerBead({ incomingImage, toolbarExtra }: {
  incomingImage?: { id: number; url: string }
  toolbarExtra?: ReactNode
}) {
  useAppLanguage()
  const loadSequence = useRef(0)
  const [editingSource, setEditingSource] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ source: string; image: HTMLCanvasElement; data: ImageData } | null>(null)
  const {
    imageUrl,
    imageElement,
    imageData,
    loadingImage,
    gridSize,
    isDetecting,
    globalRule,
    cellOverrides,
    selectedCell,
    setImage,
    setGridSize,
    setGlobalRule,
    setCellOverride,
    clearAllOverrides,
    setSelectedCell,
    setIsDetecting,
    setLoadingImage,
    reset,
    sourceHistory,
    sourceHistoryIndex,
    commitEditedImage,
    restoreSourceImage,
  } = usePerlerBeadStore()

  // 处理图片选择与自动网格识别
  const handleSelectImage = useCallback(
    async (newUrl: string) => {
      const sequence = ++loadSequence.current
      let sourceUrl = newUrl
      setLoadingImage(true)
      try {
        // Keep the undo baseline local even if the shelf file is later removed.
        if (!newUrl.startsWith('blob:')) {
          const response = await fetch(newUrl)
          if (!response.ok) throw new Error(t('加载图片失败'))
          sourceUrl = URL.createObjectURL(await response.blob())
        }
        const img = await loadImage(sourceUrl)
        if (sequence !== loadSequence.current) {
          if (sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl)
          return
        }
        // 提取原图 ImageData（限制最大尺寸 1200，保证像素统计精度的同时杜绝巨图引发 OOM）
        const { imageData: imgData } = getImageDataFromImage(img, 1200)

        // 默认按原图长宽比等比缩放，长边为 50
        const defaultGrid = getDefaultGridSize(
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
        )

        setImage(sourceUrl, img, imgData, defaultGrid)
        message.success(
          t("已载入图片，默认应用长边 50 等比网格：{0} × {1}", [defaultGrid.columns, defaultGrid.rows]),
        )
      } catch (err) {
        if (sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl)
        if (sequence !== loadSequence.current) return
        console.error(t("加载处理图片失败"), err)
        message.error(err instanceof Error ? err.message : t("加载图片失败"))
      } finally {
        if (sequence === loadSequence.current) setLoadingImage(false)
      }
    },
    [setImage, setLoadingImage, reset],
  )

  useEffect(() => {
    if (incomingImage) void handleSelectImage(incomingImage.url)
  }, [incomingImage, handleSelectImage])

  useEffect(() => { setEditingSource(null); setDraft(null) }, [imageUrl])

  const previewDraft = editingSource === imageUrl && draft?.source === imageUrl ? draft : null
  const previewImage = previewDraft?.image ?? imageElement
  const previewData = previewDraft?.data ?? imageData
  const handleDraftPreview = useCallback((canvas: HTMLCanvasElement, hasEdits: boolean) => {
    if (!editingSource || usePerlerBeadStore.getState().imageUrl !== editingSource) return
    setDraft(hasEdits ? { source: editingSource, image: canvas, data: getImageDataFromImage(canvas, 1200).imageData } : null)
  }, [editingSource])

  const handleEditConfirm = async (dataUrl: string) => {
    if (!editingSource || usePerlerBeadStore.getState().imageUrl !== editingSource) throw new Error(t('原图已变化，请重新编辑'))
    const sequence = ++loadSequence.current
    const blob = await (await fetch(dataUrl)).blob()
    const url = URL.createObjectURL(blob)
    try {
      const img = await loadImage(url)
      const { imageData: data } = getImageDataFromImage(img, 1200)
      if (sequence !== loadSequence.current || usePerlerBeadStore.getState().imageUrl !== editingSource) throw new Error(t('原图已变化，请重新编辑'))
      commitEditedImage(url, img, data)
      setEditingSource(null)
      message.success(t('图片编辑成功'))
    } catch (error) { URL.revokeObjectURL(url); throw error }
  }

  const restoreSource = async (direction: -1 | 1) => {
    const index = sourceHistoryIndex + direction
    const url = sourceHistory[index]
    if (!url || loadingImage) return
    const sequence = ++loadSequence.current
    setLoadingImage(true)
    try {
      const img = await loadImage(url)
      const { imageData: data } = getImageDataFromImage(img, 1200)
      if (sequence !== loadSequence.current) return
      if (usePerlerBeadStore.getState().sourceHistory[index] !== url) throw new Error(t('原图编辑历史已变化，请重试'))
      restoreSourceImage(index, img, data)
    } catch (error) {
      if (sequence === loadSequence.current) message.error(error instanceof Error ? error.message : t('加载图片失败'))
    } finally { if (sequence === loadSequence.current) setLoadingImage(false) }
  }

  // 手动点击重新识别网格
  const handleManualAutoDetect = useCallback(() => {
    if (!previewImage) return
    setIsDetecting(true)
    try {
      const autoResult = detectGridSize(previewImage)
      setGridSize(autoResult.gridSize)
      if (autoResult.confidence >= 0.45) {
        message.success(
          t("识别完成：{0} × {1} (置信度 {2}%)", [autoResult.gridSize.columns, autoResult.gridSize.rows, Math.round(autoResult.confidence * 100)]),
        )
      } else {
        message.info(
          t("未检测到明显网格特征，建议手动指定行列数，已重置为：{0} × {1}", [autoResult.gridSize.columns, autoResult.gridSize.rows]),
        )
      }
    } catch (err) {
      console.error(t("自动识别失败"), err)
      message.error(t("自动识别网格失败"))
    } finally {
      setIsDetecting(false)
    }
  }, [previewImage, setIsDetecting, setGridSize])

  // 单格覆盖更新
  const handleCellOverride = useCallback(
    (row: number, col: number, override: CellOverride | null) => {
      setCellOverride(row, col, override)
    },
    [setCellOverride],
  )

  // 清除全部单格覆盖
  const handleClearAllOverrides = useCallback(() => {
    clearAllOverrides()
    message.success(t("已清除全部单格覆盖，恢复全局规则"))
  }, [clearAllOverrides])

  // 高性能计算拼豆处理结果（带缓存）
  const cells: CellResult[][] | null = useMemo(() => {
    if (!previewData) return null
    return computeAllCells(previewData, gridSize, globalRule, cellOverrides)
  }, [previewData, gridSize, globalRule, cellOverrides])

  const presetColors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of cells ?? []) for (const cell of row) {
      counts.set(cell.color, (counts.get(cell.color) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([color]) => color)
  }, [cells])

  // 当前选中单元格的结果
  const selectedCellResult = useMemo(() => {
    if (!cells || !selectedCell) return null
    return cells[selectedCell.row]?.[selectedCell.column] || null
  }, [cells, selectedCell])

  // 单格覆盖数量
  const modifiedCount = useMemo(() => {
    return Object.keys(cellOverrides).length
  }, [cellOverrides])

  // 当前选中单元格的覆盖配置
  const currentCellOverride = useMemo(() => {
    if (!selectedCell) return undefined
    return cellOverrides[`${selectedCell.row},${selectedCell.column}`]
  }, [cellOverrides, selectedCell])

  const toolbar = (
    <div className="perler-toolbar flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-800 dark:text-slate-100">{t('拼豆图处理')}</span>
        {imageElement && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {t('原图')}{imageElement.naturalWidth} × {imageElement.naturalHeight}
          </span>
        )}
      </div>
      <div className="perler-toolbar-actions flex flex-wrap items-center justify-end gap-2">
        <ImageSource compact disabled={loadingImage || !!editingSource} onSelectImage={handleSelectImage} />
        {toolbarExtra}
      </div>
    </div>
  )

  // 如果没有选择图片，展示欢迎与导入页面
  if (!imageUrl) {
    return (
      <div className="perler-page flex min-h-full w-full flex-col bg-slate-50 lg:h-full dark:bg-slate-950">
        {toolbarExtra && toolbar}
        <div className="perler-content flex flex-1 items-center justify-center">
          <ImageSource onSelectImage={handleSelectImage} />
        </div>
      </div>
    )
  }

  return (
    <div className="perler-page flex min-h-full w-full flex-col bg-slate-50 lg:h-full lg:min-h-0 lg:overflow-hidden dark:bg-slate-950">
      {/* 顶部轻量工具栏 */}
      {toolbar}

      {/* 主体三栏工作区 */}
      <div className="perler-body perler-content relative flex flex-1 flex-col lg:min-h-0 lg:overflow-hidden lg:flex-row">
        {loadingImage && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-xs dark:bg-slate-950/70">
            <Spin tip={t("正在处理图片与分析网格...")} />
          </div>
        )}

        {/* 左栏：原图与网格对齐 */}
        <div className={`perler-preview ${editingSource ? 'perler-source-editing h-[420px]' : 'h-[320px]'} min-h-[300px] flex-1 overflow-hidden p-3 lg:h-auto lg:min-h-0`}>
          {editingSource ? <InlineImageEditor
            key={editingSource}
            src={editingSource}
            grid={gridSize}
            offsetX={globalRule.offsetX ?? 0.5}
            offsetY={globalRule.offsetY ?? 0.5}
            presetColors={presetColors}
            onPreview={handleDraftPreview}
            onConfirm={handleEditConfirm}
            onCancel={() => { setEditingSource(null); setDraft(null) }}
          /> :
          <GridPreview
            mode="source"
            image={imageElement}
            grid={gridSize}
            cells={cells}
            selectedCell={selectedCell}
            offsetX={globalRule.offsetX ?? 0.5}
            offsetY={globalRule.offsetY ?? 0.5}
            onSelectCell={setSelectedCell}
            title={t("原图网格对照")}
            actions={<>
              <Button size="small" icon={<EditOutlined />} disabled={loadingImage} onClick={() => setEditingSource(imageUrl)}>{t('编辑图片')}</Button>
              <Button size="small" icon={<UndoOutlined />} aria-label={t('撤销已提交的原图编辑')} disabled={loadingImage || sourceHistoryIndex <= 0} onClick={() => void restoreSource(-1)}>{t('撤销')}</Button>
              <Button size="small" icon={<RedoOutlined />} aria-label={t('重做已提交的原图编辑')} disabled={loadingImage || sourceHistoryIndex >= sourceHistory.length - 1} onClick={() => void restoreSource(1)}>{t('重做')}</Button>
            </>}
          />
          }
        </div>

        {/* 中栏：拼豆效果预览 */}
        <div className="perler-preview perler-result h-[320px] min-h-[300px] flex-1 overflow-hidden border-t border-slate-200 p-3 lg:h-auto lg:min-h-0 lg:border-t-0 lg:border-l dark:border-slate-800">
          <GridPreview
            mode="result"
            image={previewImage}
            grid={gridSize}
            cells={cells}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
            title={t("拼豆成品效果")}
          />
        </div>

        {/* 右栏：参数与工具控制面板 */}
        <div className="perler-tools w-full shrink-0 border-t border-slate-200 bg-white lg:w-84 lg:border-t-0 lg:border-l xl:w-92 dark:border-slate-800 dark:bg-slate-900/50">
          <ToolPanel
            gridSize={gridSize}
            rule={globalRule}
            selectedCell={selectedCell}
            cellOverride={currentCellOverride}
            selectedCellResult={selectedCellResult}
            cells={cells}
            image={previewImage}
            imageData={previewData}
            modifiedCount={modifiedCount}
            isDetecting={isDetecting}
            onGridSizeChange={setGridSize}
            onRuleChange={setGlobalRule}
            onCellOverride={handleCellOverride}
            onClearAllOverrides={handleClearAllOverrides}
            onAutoDetect={handleManualAutoDetect}
          />
        </div>
      </div>
    </div>
  )
}
