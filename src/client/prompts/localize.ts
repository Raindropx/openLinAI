import type { LlmPrompts } from '../../server/common/config'
import type { AppLanguage } from '../i18n'
import { ENGLISH_LLM_PROMPTS } from './defaults-en'

/** Built-in defaults follow the interface language; edited prompts remain verbatim. */
export function localizeLlmPrompt(
  key: keyof LlmPrompts,
  value: string,
  defaults: LlmPrompts | null,
  language: AppLanguage,
): string {
  if (language !== 'en-US' || !defaults || value !== defaults[key]) return value
  return ENGLISH_LLM_PROMPTS[key]
}

/** A displayed English default should not silently become a saved customization. */
export function canonicalizeLlmPrompts(
  prompts: LlmPrompts,
  defaults: LlmPrompts | null,
): LlmPrompts {
  if (!defaults) return prompts
  const result = { ...prompts }
  for (const key of Object.keys(ENGLISH_LLM_PROMPTS) as (keyof LlmPrompts)[]) {
    if (result[key] === ENGLISH_LLM_PROMPTS[key]) result[key] = defaults[key]
  }
  return result
}
