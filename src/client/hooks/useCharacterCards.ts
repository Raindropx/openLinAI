import { useRequest } from 'ahooks'
import { message } from 'antd'
import { hc } from 'hono/client'
import type { AppType } from '../../server'

const client = hc<AppType>('/')

export function useCharacterCards() {
  return useRequest(
    async () => {
      const response = await client.api['character-card'].$get()
      const result = await response.json()
      if (!result.success) throw new Error(result.error || '获取角色卡失败')
      return result.data
    },
    {
      cacheKey: 'global-character-cards',
      onError: (error) => message.error(error.message || '获取角色卡失败'),
    },
  )
}
