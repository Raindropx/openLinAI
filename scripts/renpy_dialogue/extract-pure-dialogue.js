const fs = require('node:fs/promises')
const path = require('node:path')

const inputPath = path.resolve(__dirname, 'total_dialogue.tab')
const outputPath = path.resolve(__dirname, 'pure_dialogue.txt')

function escapeDialogue(text) {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getIdentifierPrefix(identifier) {
  return identifier.replace(/_[0-9a-f]{8}(?:_\d+)?$/i, '')
}

async function main() {
  const content = await fs.readFile(inputPath, 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)

  if (lines.length <= 1) {
    await fs.writeFile(outputPath, '', 'utf8')
    console.log('No dialogue rows found.')
    return
  }

  const groups = []
  let currentGroup = null

  for (const line of lines.slice(1)) {
    const columns = line.split('\t')
    const identifier = (columns[0] || '').trim()
    const character = (columns[1] || '').trim()
    const dialogue = (columns[2] || '').trim()
    const filename = (columns[3] || '').trim()

    if (!identifier || !filename || !dialogue) {
      continue
    }

    const identifierPrefix = getIdentifierPrefix(identifier)
    const groupKey = `${filename}\t${identifierPrefix}`

    if (!currentGroup || currentGroup.key !== groupKey) {
      currentGroup = {
        key: groupKey,
        filename,
        identifierPrefix,
        dialogues: [],
      }
      groups.push(currentGroup)
    }

    const escapedDialogue = escapeDialogue(dialogue)
    currentGroup.dialogues.push(
      character ? `${character} "${escapedDialogue}"` : `"${escapedDialogue}"`,
    )
  }

  const outputLines = []

  for (const group of groups) {
    if (outputLines.length > 0) {
      outputLines.push('')
    }

    outputLines.push(`${group.filename} ${group.identifierPrefix}`)
    outputLines.push(...group.dialogues)
  }

  await fs.writeFile(outputPath, outputLines.join('\n'), 'utf8')
  console.log(`Wrote ${groups.length} groups to ${outputPath}`)
}

main().catch((error) => {
  console.error('Failed to extract dialogue:', error)
  process.exitCode = 1
})
