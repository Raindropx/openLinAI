export const YUNWU_CHAT_COMPLETIONS_URL = 'https://yunwu.ai/v1/chat/completions'

import { fetchWithTimeout } from '../utils/fetch'

export interface ChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
  }
  [key: string]: unknown
}

export interface ChatMessage {
  role: string
  content: string | ChatContentPart[]
  [key: string]: unknown
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  [key: string]: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseChatResponse(response: Response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return await response.json()
  }

  const text = await response.text()
  return {
    error: text || 'Upstream service returned an empty response',
  }
}

export async function createChatCompletion(options: {
  apiKey: string
  /** 端点 baseURL，拼 /chat/completions；不传则回退到云雾旧地址 */
  baseURL?: string
  body: ChatCompletionRequest
}) {
  const { apiKey, body, baseURL } = options

  if (body.stream) {
    return {
      status: 400,
      data: {
        success: false as const,
        error: 'stream mode is not supported',
      },
    }
  }

  const url = baseURL
    ? `${baseURL.replace(/\/$/, '')}/chat/completions`
    : YUNWU_CHAT_COMPLETIONS_URL

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      120000,
    )

    const data = await parseChatResponse(response)

    if (!response.ok) {
      return {
        status: response.status,
        data: isPlainObject(data)
          ? data
          : {
              success: false as const,
              error: 'Chat completion request failed',
            },
      }
    }

    return {
      status: response.status,
      data,
    }
  } catch (error: any) {
    return {
      status: 500,
      data: {
        success: false as const,
        error: error.message || 'Chat completion request failed',
      },
    }
  }
}
