import { requestChatCompletion } from '../../../../hooks/useChatCompletion'

function cleanModelOutput(content: string) {
  const fenced = content.match(/```(?:text)?\s*([\s\S]*?)```/i)?.[1]
  return (fenced ?? content).trim()
}

export async function optimizeStyleTemplate({
  endpointId,
  systemPrompt,
  source,
}: {
  endpointId: string
  systemPrompt: string
  source: string
}) {
  const result = cleanModelOutput(
    await requestChatCompletion({
      endpointId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: source },
      ],
    }),
  )
  const placeholders = result.match(/\{prompt\}/g)?.length ?? 0
  if (placeholders !== 1) {
    throw new Error(
      placeholders === 0
        ? '优化结果缺少 {prompt} 占位符，请重试'
        : '优化结果包含多个 {prompt} 占位符，请重试',
    )
  }
  return result
}
