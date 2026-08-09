import { Image, message } from 'antd'
import copy from 'copy-to-clipboard'
import QRCodeImg from '../../../assets/image/qrcode.jpg'
import { MessageList } from './MessageList'

const ImportantContent = () => {
  return (
    <div className="text-sm">
      <MessageList
        messages={[
          {
            icon: '✨',
            content: (
              <>
                本项目基于
                <a
                  className="mx-1 font-medium text-blue-500 underline hover:text-blue-600"
                  href="https://github.com/libudu/LinAI"
                  target="_blank"
                  rel="noreferrer"
                >
                  LinAI
                </a>
                二次开发。
              </>
            ),
          },
          {
            icon: '👤',
            content: (
              <span className="font-bold text-slate-100">
                原开发者信息：
              </span>
            ),
          },
          {
            icon: '💬',
            content: (
              <>
                <span className="font-bold text-slate-100">工具交流群：</span>
                <span
                  className="cursor-pointer font-medium text-blue-500 underline hover:text-blue-600"
                  onClick={() => {
                    copy('1098503823')
                    message.success('群号已复制')
                  }}
                >
                  1098503823
                </span>
              </>
            ),
            hidden: import.meta.env.VITE_IS_PUBLIC === 'true',
          },
        ]}
      />
      <div className="flex flex-col items-center">
        <div className="mb-1 text-lg text-slate-300">
          ☕ 感谢赞助支持，可以备注你的昵称
        </div>
        <div className="flex items-center justify-center rounded-md bg-white/10 p-2">
          <Image src={QRCodeImg} alt="赞助二维码" width={180} />
        </div>
      </div>
    </div>
  )
}

export default ImportantContent
