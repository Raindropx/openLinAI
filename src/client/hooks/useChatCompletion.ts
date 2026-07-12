import { hc } from 'hono/client'
import type { AppType } from '../../server'

const client = hc<AppType>('/')

export interface ChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface ChatMessage {
  role: string
  content: string | ChatContentPart[]
}

export interface ChatCompletionParams {
  endpointId: string
  messages: ChatMessage[]
}

/**
 * 调用 /api/chat/completions 完成一次 LLM 对话，返回纯文本回复。
 * 失败时抛出 Error（带上游错误信息）。
 */
export async function requestChatCompletion({
  endpointId,
  messages,
}: ChatCompletionParams): Promise<string> {
  const res = await client.api.chat.completions.$post({
    json: {
      endpointId,
      // model 由服务端用端点配置覆盖，这里不传
      messages: messages as any,
    },
  })

  const data: any = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
        data?.error ||
        data?.message ||
        `请求失败 (${res.status})`,
    )
  }

  const content = data?.choices?.[0]?.message?.content
  if (Array.isArray(content)) {
    // 多模态返回：拼接文本部分
    return content
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
  }
  if (typeof content === 'string') {
    return content
  }
  throw new Error('模型未返回有效文本')
}
