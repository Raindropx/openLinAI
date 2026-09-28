import {
  CheckSquareOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import { Button, Input, Modal, Select, Spin, message } from 'antd'
import { hc } from 'hono/client'
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  type ForwardedRef,
} from 'react'
import type { AppType } from '../../../../../server'
import type { TaskTemplate } from '../../../../../server/common/template-manager'
import { useLocalSetting } from '../../../../hooks/useLocalSetting'
import { useTemplates } from '../../../../hooks/useTemplates'
import { t, useAppLanguage } from '../../../../i18n'
import { localizeSampleTemplate } from '../../../../presets/sample-templates'
import {
  ListToolbar,
  sortListItems,
  type ListSortMode,
} from '../../components/ListToolbar'
import { RenameFolderModal } from '../TemplateItem/RenameFolderModal'
import { TemplateItemList } from './TemplateItemList'

const client = hc<AppType>('/')

export interface TemplateListRef {
  refresh: () => void
}

interface TemplateListProps {
  onLoadTemplate: (template: TaskTemplate) => void
  variant?: 'panel' | 'management'
  activeTemplateId?: string | null
  clickToLoad?: boolean
}

function compareTemplateOrder(a: TaskTemplate, b: TaskTemplate) {
  if (a.sortOrder === undefined && b.sortOrder === undefined) {
    return (b.createdAt || 0) - (a.createdAt || 0)
  }
  if (a.sortOrder === undefined) return -1
  if (b.sortOrder === undefined) return 1
  return a.sortOrder - b.sortOrder
}

export const TemplateList = forwardRef<TemplateListRef, TemplateListProps>(
  TemplateListComponent,
)

function TemplateListComponent(
  {
    onLoadTemplate,
    variant = 'panel',
    activeTemplateId = null,
    clickToLoad = false,
  }: TemplateListProps,
  ref: ForwardedRef<TemplateListRef>,
) {
  const { language } = useAppLanguage()

  const managementMode = variant === 'management'
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [sortMode, setSortMode] = useState<ListSortMode>('default')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchBusy, setBatchBusy] = useState(false)
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [targetFolder, setTargetFolder] = useState('__root__')
  const [newFolder, setNewFolder] = useState('')
  const { gptImageSettings } = useLocalSetting()
  const infiniteScroll = managementMode
    ? (gptImageSettings.templateManagerInfiniteScroll ?? true)
    : (gptImageSettings.workspaceListInfiniteScroll ?? true)
  const pageSize = managementMode
    ? (gptImageSettings.templateManagerPageSize ?? 12)
    : (gptImageSettings.workspaceListPageSize ?? 8)

  const { data: templates = [], loading, refresh } = useTemplates()

  useImperativeHandle(ref, () => ({ refresh }))

  const imageTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.usageType === 'image' || template.usageType === 'chat-image',
      ),
    [templates],
  )

  const filteredTemplates = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase('zh-CN')
    const matchedTemplates = keyword
      ? imageTemplates.filter((template) =>
          [localizeSampleTemplate(template, language).title, localizeSampleTemplate(template, language).prompt, template.folder].some((value) =>
            String(value || '')
              .toLocaleLowerCase('zh-CN')
              .includes(keyword),
          ),
        )
      : imageTemplates

    return sortListItems(matchedTemplates, sortMode, {
      getTime: (template) => template.createdAt || 0,
      getTitle: (template) => {
        const shown = localizeSampleTemplate(template, language)
        return shown.title || shown.prompt || ''
      },
      defaultCompare: compareTemplateOrder,
    })
  }, [imageTemplates, searchText, sortMode, language])

  const folders = useMemo(
    () =>
      Array.from(
        new Set(
          imageTemplates
            .map((template) => template.folder)
            .filter((folder): folder is string => Boolean(folder)),
        ),
      ).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [imageTemplates],
  )

  const selectableTemplates = selectedFolder
    ? filteredTemplates.filter((template) => template.folder === selectedFolder)
    : filteredTemplates.filter((template) => !template.folder)

  const toggleTemplateSelection = (templateId: string) => {
    setSelectedIds((ids) =>
      ids.includes(templateId)
        ? ids.filter((id) => id !== templateId)
        : [...ids, templateId],
    )
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const handleBatchDelete = () => {
    if (!selectedIds.length) {
      message.info(t('请先选择要删除的模板'))
      return
    }

    Modal.confirm({
      title: t('确认删除选中的 {0} 个模板？', [selectedIds.length]),
      content: t(
        '删除后无法恢复，模板引用的本地图片不会因此从任务列表中删除。',
      ),
      okText: t('批量删除'),
      okType: 'danger',
      onOk: async () => {
        setBatchBusy(true)
        let successCount = 0
        for (const id of selectedIds) {
          try {
            const response = await client.api.template[':id'].$delete({
              param: { id },
            })
            const result = await response.json()
            if (result.success) successCount += 1
          } catch {
            // 继续处理剩余模板。
          }
        }
        setBatchBusy(false)
        exitSelectionMode()
        refresh()
        if (successCount === selectedIds.length) {
          message.success(t('已删除 {0} 个模板', [successCount]))
        } else {
          message.warning(
            t('已删除 {0} 个模板，{1} 个删除失败', [
              successCount,
              selectedIds.length - successCount,
            ]),
          )
        }
      },
    })
  }

  const handleMoveTemplates = async () => {
    const folder =
      targetFolder === '__new__'
        ? newFolder.trim()
        : targetFolder === '__root__'
          ? ''
          : targetFolder

    if (targetFolder === '__new__' && !folder) {
      message.warning(t('请输入新文件夹名称'))
      return
    }

    setBatchBusy(true)
    let successCount = 0
    for (const id of selectedIds) {
      try {
        const response = await client.api.template[':id'].$put({
          param: { id },
          json: { folder },
        })
        const result = await response.json()
        if (result.success) successCount += 1
      } catch {
        // 继续处理剩余模板。
      }
    }
    setBatchBusy(false)
    setMoveModalOpen(false)
    setNewFolder('')
    exitSelectionMode()
    refresh()
    if (successCount === selectedIds.length) {
      message.success(t('已移动 {0} 个模板', [successCount]))
    } else {
      message.warning(
        t('已移动 {0} 个模板，{1} 个移动失败', [
          successCount,
          selectedIds.length - successCount,
        ]),
      )
    }
  }

  const managementActions = managementMode ? (
    selectionMode ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <span className="text-xs whitespace-nowrap text-slate-400">
          {t('已选')} {selectedIds.length}
        </span>
        <Button
          size="small"
          onClick={() =>
            setSelectedIds(selectableTemplates.map((template) => template.id))
          }
          disabled={!selectableTemplates.length}
        >
          {t('全选')}
        </Button>
        <Button
          size="small"
          icon={<FolderOpenOutlined />}
          disabled={!selectedIds.length}
          onClick={() => setMoveModalOpen(true)}
        >
          {t('移动')}
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          loading={batchBusy}
          disabled={!selectedIds.length}
          onClick={handleBatchDelete}
        >
          {t('删除')}
        </Button>
        <Button size="small" onClick={exitSelectionMode}>
          {t('退出')}
        </Button>
      </div>
    ) : (
      <Button
        size="small"
        icon={<CheckSquareOutlined />}
        onClick={() => setSelectionMode(true)}
      >
        {t('多选')}
      </Button>
    )
  ) : undefined

  return (
    <>
      <div
        className={
          managementMode
            ? 'flex w-full flex-col p-0 sm:absolute sm:inset-0 sm:max-h-none sm:p-3'
            : 'flex max-h-120 w-full flex-col p-3 md:absolute md:inset-0 md:max-h-none'
        }
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3 sm:mb-3">
          <h3 className="m-0 flex min-w-0 items-center text-base font-semibold text-slate-100 sm:text-sm">
            {selectedFolder ? (
              <>
                <button
                  type="button"
                  className="app-accent-hover cursor-pointer truncate border-0 bg-transparent p-0 text-slate-400 transition-colors"
                  onClick={() => setSelectedFolder(null)}
                >
                  {t('模板列表 (')}
                  {filteredTemplates.length})
                </button>
                <span className="mx-2 font-normal text-slate-600">/</span>
                <span className="truncate">{selectedFolder}</span>
              </>
            ) : (
              <span>
                {t('模板列表 (')}
                {filteredTemplates.length})
              </span>
            )}
          </h3>
          {selectedFolder && !selectionMode && (
            <Button type="link" onClick={() => setIsRenameModalOpen(true)}>
              {t('重命名文件夹')}
            </Button>
          )}
        </div>

        <div className="mb-3 shrink-0">
          <ListToolbar
            compact={!managementMode}
            fluidSortOnMobile={managementMode}
            searchValue={searchText}
            onSearchChange={setSearchText}
            sortMode={sortMode}
            onSortChange={setSortMode}
            searchPlaceholder={t('搜索模板标题、提示词或文件夹')}
            actions={managementActions}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spin />
            </div>
          ) : (
            <TemplateItemList
              filteredTemplates={filteredTemplates}
              selectedFolder={selectedFolder}
              onSelectFolder={(folder) => {
                setSelectedFolder(folder)
                setSelectedIds([])
              }}
              onLoadTemplate={onLoadTemplate}
              layout={managementMode ? 'grid' : 'list'}
              pageScrollOnMobile={managementMode}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleTemplateSelection}
              draggable={
                sortMode === 'default' && !searchText.trim() && !selectionMode
              }
              infiniteScroll={infiniteScroll}
              pageSize={pageSize}
              activeTemplateId={activeTemplateId}
              clickToLoad={clickToLoad}
            />
          )}
        </div>
      </div>

      {selectedFolder && (
        <RenameFolderModal
          folder={selectedFolder}
          open={isRenameModalOpen}
          onCancel={() => setIsRenameModalOpen(false)}
          onSuccess={(renamedFolder) => {
            setIsRenameModalOpen(false)
            setSelectedFolder(renamedFolder)
            refresh()
          }}
        />
      )}

      <Modal
        title={t('移动 {0} 个模板', [selectedIds.length])}
        open={moveModalOpen}
        onCancel={() => setMoveModalOpen(false)}
        onOk={handleMoveTemplates}
        okText={t('移动')}
        confirmLoading={batchBusy}
      >
        <div className="flex flex-col gap-3 pt-2">
          <Select
            value={targetFolder}
            onChange={setTargetFolder}
            options={[
              { value: '__root__', label: t('不放入文件夹') },
              ...folders.map((folder) => ({ value: folder, label: folder })),
              { value: '__new__', label: t('新建文件夹…') },
            ]}
          />
          {targetFolder === '__new__' && (
            <Input
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
              placeholder={t('输入新文件夹名称')}
              onPressEnter={handleMoveTemplates}
            />
          )}
        </div>
      </Modal>
    </>
  )
}
