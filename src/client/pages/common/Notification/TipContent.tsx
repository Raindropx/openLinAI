import { message } from 'antd'
import copy from 'copy-to-clipboard'
import { useGlobalStore } from '../../../store/global'
import { MessageItem, MessageList } from './MessageList'

const TipContent = () => {
  const localNetworkUrl = useGlobalStore((state) => state.localNetworkUrl)

  const tipsMessages: MessageItem[] = [
    {
      icon: '🔄',
      content: (
        <>
          <span className="font-bold text-gray-900">快速升级：</span>
          将新版本压缩包直接拖放至“版本迁移”批处理（.bat）脚本上，即可保留用户数据的同时自动完成版本升级。
        </>
      ),
    },
    {
      icon: '🎨',
      content: (
        <>
          <span className="font-bold text-gray-900">提示词技巧：</span>
          部分模型的文字审查机制较为严格（如 GPT Image
          2），建议优先采用上传图片作为参考的方式进行生成，以提高成功率。
        </>
      ),
    },
    {
      icon: '🌐',
      content: (
        <>
          <span className="font-bold text-gray-900">局域网访问：</span>
          相同局域网下，其他设备（如移动端）可以通过访问内网地址来使用本服务：
          <span
            className="cursor-pointer font-medium text-blue-500 underline hover:text-blue-600"
            onClick={() => {
              if (!localNetworkUrl) {
                return
              }
              copy(localNetworkUrl)
              message.success('内网地址已复制')
            }}
          >
            {localNetworkUrl}
          </span>
        </>
      ),
      hidden: !localNetworkUrl,
    },
  ]

  return <MessageList messages={tipsMessages} />
}

export default TipContent
