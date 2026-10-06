import { Form, Select } from 'antd'
import { useTasks } from '../../../../hooks/useTasks'
import { t, useAppLanguage } from '../../../../i18n'
import { useGlobalStore } from '../../../../store/global'

export function TaskFolderSelect() {
  useAppLanguage()
  const { folders } = useTasks()
  const folderId = useGlobalStore((state) => state.generationFolderId)
  const setFolderId = useGlobalStore((state) => state.setGenerationFolderId)
  return (
    <Form.Item
      label={t('生成到文件夹')}
      htmlFor="generation-task-folder"
      className="mb-2!"
    >
      <Select
        id="generation-task-folder"
        value={folderId}
        onChange={setFolderId}
        showSearch
        optionFilterProp="label"
        options={[
          { value: '', label: t('主文件夹') },
          ...folders.map((folder) => ({
            value: folder.id,
            label: folder.name,
          })),
        ]}
      />
    </Form.Item>
  )
}
