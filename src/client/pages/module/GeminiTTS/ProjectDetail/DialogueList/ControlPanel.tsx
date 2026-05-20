import {
  PlusOutlined,
  SoundOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Button, message } from 'antd'
import { useMemo, useRef } from 'react'
import { TTSCharacter, TTSDialogue } from '../../../../../../server/module/tts'
import { ExportAudioButton } from './ExportAudioButton'
import { ImportRenpyModal, ImportRenpyModalRef } from './ImportRenpyModal'

interface ControlPanelProps {
  dialogues: TTSDialogue[]
  characters: TTSCharacter[]
  onAddClick: () => void
  onUpdateProject: (updates: any) => void
}

export const ControlPanel = ({
  dialogues,
  characters,
  onAddClick,
  onUpdateProject,
}: ControlPanelProps) => {
  const importModalRef = useRef<ImportRenpyModalRef>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const issues = useMemo(() => {
    const list: string[] = []
    const hasMissingCharacter = dialogues.some(
      (d) => !characters.find((c) => c.id === d.characterId),
    )
    if (hasMissingCharacter) {
      list.push('语句对应的人物不存在')
    }
    return list
  }, [dialogues, characters])

  const hasIssues = issues.length > 0

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      importModalRef.current?.open(file)
    }
    e.target.value = ''
  }

  const handleImportConfirm = (
    newCharacters: TTSCharacter[],
    newDialogues: TTSDialogue[],
  ) => {
    onUpdateProject({
      characters: [...characters, ...newCharacters],
      dialogues: [...dialogues, ...newDialogues],
    })
  }

  return (
    <>
      <input
        type="file"
        accept=".tab,.txt"
        style={{ display: 'none' }}
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <div className="mb-4 grid grid-cols-2 gap-4">
        {/* 左侧：创建对话卡片 */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <div>
            <h3 className="mb-2 text-base font-medium text-slate-800">
              创建对话
            </h3>
            <p className="mb-5 text-sm text-slate-500">
              从外部文件导入或手动添加单条对话记录
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleImportClick} icon={<UploadOutlined />}>
              从 Renpy Dialogue.tab 导入
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onAddClick}>
              添加单条对话
            </Button>
          </div>
        </div>

        {/* 右侧：生成语音卡片 */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <div>
            <h3 className="mb-2 text-base font-medium text-slate-800">
              生成语音
            </h3>
            {hasIssues ? (
              <div className="mb-5 flex flex-col gap-1 text-sm text-amber-600">
                <div className="flex items-center gap-1 font-medium">
                  <WarningOutlined />
                  <span>当前存在以下问题，暂无法生成：</span>
                </div>
                <ul className="list-disc pl-5 text-amber-500">
                  {issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mb-5 text-sm text-slate-500">
                所有语句均已就绪，可一键批量生成音频
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              type="primary"
              icon={<SoundOutlined />}
              onClick={() => {
                message.info('批量生成功能暂未实现')
              }}
              disabled={hasIssues}
            >
              批量生成语音
            </Button>
            <ExportAudioButton dialogues={dialogues} />
          </div>
        </div>
      </div>

      <ImportRenpyModal
        ref={importModalRef}
        characters={characters}
        onConfirm={handleImportConfirm}
      />
    </>
  )
}
