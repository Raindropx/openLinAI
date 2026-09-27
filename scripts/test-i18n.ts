import assert from 'node:assert/strict'
import fs from 'node:fs'

async function main() {
  // Isolate browser storage and document state; never touch the user's real settings.
  const storage = new Map<string, string>()
  const browser = new EventTarget()
  Object.assign(browser, {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null },
  })
  Object.assign(globalThis, {
    window: browser,
    document: { documentElement: { lang: '' }, title: '' },
  })
  const { readStoredLanguage, t, translateError } =
    await import('../src/client/i18n')
  const setStoredLanguage = (value?: string) => {
    if (value === undefined) storage.delete('app_language')
    else storage.set('app_language', value)
    const event = new Event('storage')
    Object.assign(event, { key: 'app_language' })
    browser.dispatchEvent(event)
  }

  assert.equal(readStoredLanguage(), 'zh-CN')
  assert.equal(t('设置'), '设置')
  assert.equal(document.documentElement.lang, 'zh-CN')
  setStoredLanguage('en-US')
  assert.equal(t('设置'), 'Settings')
  assert.equal(t('生成图片', [], 'action'), 'Generate images')
  assert.equal(t('张', [], 'character-card'), 'cards')
  assert.equal(document.documentElement.lang, 'en-US')
  assert.equal(document.title, 'LinAI: AI Task Workspace')
  assert.equal(
    t('已删除 {0} 个任务，{1} 个删除失败', [3, 1]),
    'Deleted 3 tasks; 1 failed',
  )
  assert.equal(
    t('已载入“{0}”', ['Original {1} <内容>']),
    'Loaded “Original {1} <内容>”',
  )
  assert.equal(t('constructor'), 'constructor')
  assert.equal(
    t('Unrecognized provider message'),
    'Unrecognized provider message',
  )
  assert.equal(
    translateError('NovelAI 验证失败 (401)'),
    'NovelAI verification failed (401)',
  )
  assert.equal(
    translateError('[服务] Unknown upstream error'),
    '[Service] Unknown upstream error',
  )
  setStoredLanguage('unsupported')
  assert.equal(t('设置'), '设置')
  assert.equal(document.documentElement.lang, 'zh-CN')
  setStoredLanguage()
  assert.equal(readStoredLanguage(), 'zh-CN')

  const english: Record<string, string> = JSON.parse(
    fs.readFileSync('src/client/locales/en-US.json', 'utf8'),
  )
  const placeholders = (value: string) =>
    [...value.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1])).sort()
  for (const [source, translation] of Object.entries(english)) {
    assert.ok(translation.trim(), `Empty translation: ${source}`)
    assert.deepEqual(
      placeholders(translation),
      placeholders(source),
      `Placeholder mismatch: ${source}`,
    )
  }
  console.log(
    `i18n checks passed (${Object.keys(english).length} translations)`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
