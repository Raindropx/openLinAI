import { MessageItem, MessageList } from './MessageList'

const TipContent = () => {
  const tipsMessages: MessageItem[] = [
    {
      icon: '🔄',
      content: (
        <>
          <span className="font-bold text-slate-100">快速升级：</span>
          将新版本压缩包直接拖放至“版本迁移”批处理（.bat）脚本上，即可保留用户数据的同时自动完成版本升级。
        </>
      ),
    },
    {
      icon: '🎨',
      content: (
        <>
          <span className="font-bold text-slate-100">提示词技巧：</span>
          部分模型的文字审查机制较为严格（如 GPT Image
          2），建议优先采用上传图片作为参考的方式进行生成，以提高成功率。
        </>
      ),
    },
    {
      icon: '💰',
      content: (
        <>
          <span className="font-bold text-slate-100">移动端余额：</span>
          在页面顶部向下拉，即可查看当前图片端点的余额；点击余额卡片可直接进入图片端点设置。仅在当前端点支持并已启用余额查询时显示。
        </>
      ),
    },
    {
      icon: '🌐',
      content: (
        <>
          <span className="font-bold text-slate-100">局域网访问：</span>
          Windows 发布版和路由器部署默认使用 3000
          端口。Windows 本机访问{' '}
          <code>http://127.0.0.1:3000</code>；同一局域网的其他设备访问{' '}
          <code>http://&lt;Windows 设备的局域网 IPv4&gt;:3000</code>，可用{' '}
          <code>ipconfig</code> 查看 IPv4 地址，并需允许 Windows
          防火墙放行该端口。路由器默认访问{' '}
          <code>http://&lt;路由器 IP&gt;:3000</code>。源码开发模式的前端默认为{' '}
          <code>5174</code> 端口；若修改了 <code>PORT</code>{' '}
          或使用了 nginx 反向代理，请以实际端口为准。
        </>
      ),
    },
  ]

  return <MessageList messages={tipsMessages} />
}

export default TipContent
