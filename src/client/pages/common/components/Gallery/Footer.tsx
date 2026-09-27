import { Button, message, Modal } from 'antd'
import { hc } from 'hono/client'
import type { AppType } from '../../../../../server'
import { t, useAppLanguage } from '../../../../i18n'

type GalleryImageType = 'input' | 'generated'
export type GalleryDeleteSuccessPayload = {
  type: GalleryImageType
  urls: string[]
  deletedCount: number
  skippedCount: number
}

const client = hc<AppType>('/')

interface GalleryFooterProps {
  activeKey: string
  selectedUrls: string[]
  images: Array<{
    url: string
    type: GalleryImageType
    isReferenced: boolean
  }>
  onCancel: () => void
  onConfirm: () => void
  onDelete: (payload: GalleryDeleteSuccessPayload) => Promise<void> | void
}

const getTabType = (activeKey: string): GalleryImageType | null =>
  activeKey === 'input' || activeKey === 'generated' ? activeKey : null

export function GalleryFooter({
  activeKey,
  selectedUrls,
  images,
  onCancel,
  onConfirm,
  onDelete,
}: GalleryFooterProps) {
  useAppLanguage()

  const currentTabType = getTabType(activeKey)
  const currentTabImages = currentTabType
    ? images.filter((image) => image.type === currentTabType)
    : []
  const selectedCurrentTabUrls = currentTabImages
    .filter((image) => selectedUrls.includes(image.url))
    .map((image) => image.url)

  const hasSelectedImagesInCurrentTab = selectedCurrentTabUrls.length > 0

  const getDeleteButtonText = () => {
    if (!currentTabType) {
      return ''
    }

    const imageTypeLabel = currentTabType === 'input' ? t('输入') : t('生成')

    return hasSelectedImagesInCurrentTab
      ? t('删除选中的无引用{0}图片', [imageTypeLabel])
      : t('删除无引用{0}图片', [imageTypeLabel])
  }

  const getDeleteCandidateUrls = () => {
    if (!currentTabType) {
      return []
    }

    const targetUrls =
      selectedCurrentTabUrls.length > 0
        ? selectedCurrentTabUrls
        : currentTabImages.map((image) => image.url)

    return targetUrls.filter((url) =>
      currentTabImages.some(
        (image) => image.url === url && image.isReferenced === false,
      ),
    )
  }

  const handleDeleteImages = () => {
    if (!currentTabType) {
      return
    }

    const candidateUrls = getDeleteCandidateUrls()
    const imageTypeLabel = currentTabType === 'input' ? t('输入') : t('生成')

    if (candidateUrls.length === 0) {
      message.info(
        hasSelectedImagesInCurrentTab
          ? t('当前选中的{0}图片均有引用，无法删除', [imageTypeLabel])
          : t('当前没有可删除的无引用{0}图片', [imageTypeLabel]),
      )
      return
    }

    Modal.confirm({
      title: getDeleteButtonText(),
      content: t('确定删除 {0} 张无引用{1}图片吗？', [
        candidateUrls.length,
        imageTypeLabel,
      ]),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const response = await client.api.static.images[
            'delete-unreferenced'
          ].$post({
            json: {
              type: currentTabType,
              urls: candidateUrls,
            },
          })
          const data = await response.json()

          if (!data.success) {
            message.error(t(data.error || '') || t('删除失败'))
            return
          }

          await onDelete({
            type: currentTabType,
            urls: candidateUrls,
            deletedCount: data.deletedCount,
            skippedCount: data.skippedCount,
          })

          if (data.skippedCount > 0) {
            message.success(
              t('删除完成，已删除 {0} 张，跳过 {1} 张有引用图片', [
                data.deletedCount,
                data.skippedCount,
              ]),
            )
            return
          }

          message.success(t('删除完成，已删除 {0} 张图片', [data.deletedCount]))
        } catch (error: any) {
          message.error(t(error.message) || t('请求失败'))
        }
      },
    })
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {currentTabType && (
        <div className="w-full sm:w-auto">
          <Button danger onClick={handleDeleteImages}>
            {getDeleteButtonText()}
          </Button>
        </div>
      )}
      <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
        <Button className="min-w-0 flex-1 sm:flex-none" onClick={onCancel}>
          {t('取消')}
        </Button>
        <Button
          className="min-w-0 flex-1 sm:flex-none"
          type="primary"
          onClick={onConfirm}
          disabled={selectedUrls.length === 0}
        >
          {t('确认选择')}
        </Button>
      </div>
    </div>
  )
}
