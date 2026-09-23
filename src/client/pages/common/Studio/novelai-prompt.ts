/** Parse the sections requested by the NovelAI optimization system prompts. */
export function parseNovelAIOptimizedPrompt(raw: string) {
  const sections: Record<string, string[]> = {}
  let current = 'prompt'
  let sawHeading = false

  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.trim().match(/^(?:#{1,6}\s*)?(?:\*\*)?(Base Prompt|Prompt|Character Prompt|UC|Undesired Content)(?:\*\*)?\s*[:：]?\s*$/i)
    if (heading) {
      if (!sawHeading) sections.prompt = []
      current = /character/i.test(heading[1]) ? 'characters'
        : /^(UC|Undesired Content)$/i.test(heading[1]) ? 'uc' : 'prompt'
      sections[current] ??= []
      sawHeading = true
    } else {
      ;(sections[current] ??= []).push(line)
    }
  }

  const clean = (lines?: string[]) => lines
    ?.filter((line) => !/^\s*```/.test(line))
    .join('\n').trim() || undefined
  const prompt = clean(sections.prompt)
  const uc = clean(sections.uc)
  const characters = clean(sections.characters)
    ?.split(/(?:^|\n)\s*Character\s+\d+\s*[:：]\s*/i)
    .map((part) => part.trim())
    .filter(Boolean) || []

  return { prompt: sawHeading ? prompt : clean(raw.split('\n')), uc, characters }
}
