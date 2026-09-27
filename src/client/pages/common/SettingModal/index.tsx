import { Modal, Tabs } from 'antd'
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { usePlatform } from '../../../hooks/usePlatform'
import { t, useAppLanguage } from '../../../i18n'
import { AppThemeProvider } from '../../../theme'
import { AdminSetting, AdminSettingRef } from './AdminSetting'
import { FeatureSetting } from './FeatureSetting'
import { GPTImageSetting, GPTImageSettingRef } from './GPTImageSetting'
import { InterfaceSetting } from './InterfaceSetting'
import { LlmSetting, LlmSettingRef } from './LlmSetting'

export const isAdmin = () => {
  return (
    window.location.hostname === 'localhost' && !!localStorage.getItem('admin')
  )
}

export function openSettingModal(options?: {
  initialTab?: string
  onSuccess?: (apiKey: string) => void
}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  function destroy() {
    root.unmount()
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }

  function ModalComponent() {
    useAppLanguage()

    const [activeTab, setActiveTab] = useState(
      options?.initialTab || 'gpt-image',
    )
    const { isMobile } = usePlatform()
    const gptImageRef = useRef<GPTImageSettingRef>(null)
    const llmRef = useRef<LlmSettingRef>(null)
    const adminRef = useRef<AdminSettingRef>(null)

    const handleSave = async () => {
      try {
        if (activeTab === 'gpt-image') {
          const apiKey = await gptImageRef.current?.save()
          if (apiKey) {
            options?.onSuccess?.(apiKey)
          }
        } else if (activeTab === 'llm-endpoints') {
          await llmRef.current?.save()
        } else if (activeTab === 'admin') {
          await adminRef.current?.save()
        }
        destroy()
      } catch (error) {
        // 表单验证失败或其他错误
      }
    }

    const items = [
      {
        key: 'gpt-image',
        label: t('图片端点'),
        children: <GPTImageSetting ref={gptImageRef} />,
      },
      {
        key: 'llm-endpoints',
        label: t('LLM 端点'),
        children: <LlmSetting ref={llmRef} />,
      },
      {
        key: 'features',
        label: t('功能设置'),
        children: <FeatureSetting />,
      },
      {
        key: 'interface',
        label: t('界面设置'),
        children: <InterfaceSetting />,
      },
    ]

    if (isAdmin()) {
      items.push({
        key: 'admin',
        label: t('管理员设置'),
        children: <AdminSetting ref={adminRef} />,
      })
    }

    return (
      <Modal
        title={t('设置')}
        open={true}
        onCancel={destroy}
        onOk={handleSave}
        okText={options?.onSuccess ? t('保存并继续') : t('保存')}
        cancelText={t('取消')}
        footer={activeTab === 'admin' ? null : undefined}
        destroyOnHidden
        width={isMobile ? '92vw' : 920}
        styles={{
          body: { maxHeight: '72vh', overflowY: 'auto' },
        }}
      >
        <div className="min-h-[200px] pt-4">
          <Tabs
            tabPosition={isMobile ? 'top' : 'left'}
            activeKey={activeTab}
            onChange={setActiveTab}
            items={items}
            styles={{
              item: {
                padding: '8px 16px',
              },
            }}
          />
        </div>
      </Modal>
    )
  }

  root.render(
    <AppThemeProvider>
      <ModalComponent />
    </AppThemeProvider>,
  )
}
