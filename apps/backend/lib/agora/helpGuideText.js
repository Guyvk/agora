/**
 * Agora: the guide as text, for Claude in Help (helpClaude.js).
 *
 * It is made from the same guide that members read at /guide and under Guide
 * in the Help window: the parts in apps/web/src/agora/guide/guideParts.json,
 * in that order, with their English texts from apps/web/public/locales/en.json.
 * After the guide come the extra notes for the Help desk in helpGuide.md next
 * to this file: things that are not in the guide, such as where settings are.
 *
 * AGORA_HELP_GUIDE_FILE, when set, replaces all of this with one file.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const WEB = join(__dirname, '..', '..', '..', 'web')
export const GUIDE_PARTS_FILE = join(WEB, 'src', 'agora', 'guide', 'guideParts.json')
export const LOCALE_FILE = join(WEB, 'public', 'locales', 'en.json')
export const NOTES_FILE = join(__dirname, 'helpGuide.md')

function readJson (file) {
  return JSON.parse(readFileSync(file).toString())
}

function fill (text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (all, name) => (values && values[name]) || all)
}

/** The guide's parts as Markdown, in English. `words` maps each key to its English text. */
export function guideMarkdown (guide, words) {
  const t = (key, values) => fill(typeof words[key] === 'string' ? words[key] : key, values)
  // $circle is the member's own circle, which the page fills in
  const link = block => `- Link: ${t(block.label, { name: 'your circle' })} (${block.link.replace('$circle', '/groups/<your circle>')})`
  const lines = ['# The Agora guide (what members read at /guide and under Guide in the Help window)', '', t(guide.intro)]
  guide.parts.forEach(part => {
    lines.push('', `## ${t(part.title)} (/guide#${part.id})`, '')
    part.blocks.forEach(block => {
      if (block.text) lines.push(t(block.text), '')
      else if (block.strong) lines.push(`**${t(block.strong)}**`, '')
      else if (block.soon) lines.push(`${t('Coming soon')}: ${t(block.soon)}`, '')
      else if (block.list) lines.push(...block.list.map(item => `- ${t(item)}`), '')
      else if (block.link) lines.push(link(block), '')
      else if (block.links) lines.push(...block.links.map(link), '')
      else if (block.openHelp) lines.push(`- Button: ${t(block.label)} (opens the Help window)`, '')
    })
    while (lines[lines.length - 1] === '') lines.pop()
  })
  return lines.join('\n')
}

/**
 * Everything Claude answers from: the guide, then the Help desk notes.
 * If the guide cannot be read, only the notes, and the reason is logged.
 */
export function buildHelpGuide () {
  if (process.env.AGORA_HELP_GUIDE_FILE) {
    try {
      return readFileSync(process.env.AGORA_HELP_GUIDE_FILE).toString()
    } catch (e) {
      console.error('Agora help: cannot read AGORA_HELP_GUIDE_FILE', e.message)
      return ''
    }
  }
  const pieces = []
  try {
    pieces.push(guideMarkdown(readJson(GUIDE_PARTS_FILE), readJson(LOCALE_FILE)))
  } catch (e) {
    console.error('Agora help: cannot read the guide for Claude', e.message)
  }
  try {
    pieces.push(readFileSync(NOTES_FILE).toString().trim())
  } catch (e) {
    console.error('Agora help: cannot read helpGuide.md', e.message)
  }
  return pieces.join('\n\n')
}
