import { Modal, Tabs } from 'antd'
import { createRoot } from 'react-dom/client'
import { t, useAppLanguage } from '../../../i18n'
import { AppThemeProvider } from '../../../theme'
import ErrorContent from './ErrorContent'
import ImportantContent from './ImportantContent'
import TipContent from './TipContent'
import UpgradeContent from './UpgradeContent'

export function openNotificationModal() {
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

    const items = [
      {
        key: 'important',
        label: t('📢 重要说明'),
        children: <ImportantContent />,
      },
      {
        key: 'tip',
        label: t('💡 高级技巧'),
        children: <TipContent />,
      },
      {
        key: 'error',
        label: t('🚨 错误提示'),
        children: <ErrorContent />,
      },
      {
        key: 'upgrade',
        label: t('💅 更新日志'),
        children: <UpgradeContent />,
      },
    ]

    return (
      <Modal
        title={
          <span className="flex items-center gap-2 text-xl font-semibold">
            <span>🔔</span> {t('通知与说明')}
          </span>
        }
        classNames={{
          header: 'mb-0!',
        }}
        open={true}
        onCancel={destroy}
        footer={null}
        destroyOnHidden
        width={650}
      >
        <div className="min-h-[350px]">
          <Tabs
            items={items}
            defaultActiveKey="important"
            size="large"
            className="px-2 py-4 text-sm sm:text-base!"
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
