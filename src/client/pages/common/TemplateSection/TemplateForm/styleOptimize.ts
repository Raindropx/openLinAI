import { requestChatCompletion } from '../../../../hooks/useChatCompletion'
import { t } from '../../../../i18n'

function cleanModelOutput(content: string) {
  const fenced = content.match(/```(?:text)?\s*([\s\S]*?)```/i)?.[1]
  return (fenced ?? content).trim()
}

export function resolveStylePrompt(template: string, currentPrompt: string) {
  const prompt = currentPrompt.trim() || t('此画面')
  return template.split('{prompt}').join(prompt).trim()
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
        ? t('优化结果缺少 {prompt} 占位符，请重试')
        : t('优化结果包含多个 {prompt} 占位符，请重试'),
    )
  }
  return result
}
