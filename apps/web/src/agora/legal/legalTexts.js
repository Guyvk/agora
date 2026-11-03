/**
 * Agora: the shape of the Terms of use (/terms) and the Privacy notice
 * (/privacy). The words themselves are in public/locales/*.json, under keys
 * that start with "agoraTerms.", "agoraPrivacy." and "agoraLegal.".
 *
 * Each section lists its blocks: 'p' is a paragraph, a number is a list with
 * that many items. Keys are numbered in order: the first block of section
 * "who" of the privacy notice is "agoraPrivacy.who.1", the next one ".2", and
 * so on, list items included. The section title is "<prefix>.<section>.title".
 *
 * Both texts are drafts. Change the words in en.json; change this file only
 * to add, remove or reorder a section or a paragraph.
 */

/** Where the two pages live. Both can be read without logging in. */
export const LEGAL_PATHS = { terms: '/terms', privacy: '/privacy' }

function build (prefix, sectionShapes, openPointCount) {
  const sections = sectionShapes.map(([id, shape]) => {
    let n = 0
    const key = () => `${prefix}.${id}.${++n}`
    const blocks = shape.map(block => block === 'p'
      ? { type: 'p', key: key() }
      : { type: 'ul', keys: Array.from({ length: block }, key) })
    return { id, title: id === 'intro' ? null : `${prefix}.${id}.title`, blocks }
  })
  const openPoints = Array.from({ length: openPointCount }, (_, i) => `${prefix}.open.${i + 1}`)
  return { title: `${prefix}.title`, sections, openPoints }
}

export const TERMS = build('agoraTerms', [
  ['intro', ['p']],
  ['what', ['p']],
  ['who', ['p', 3]],
  ['conduct', ['p', 6]],
  ['content', ['p', 'p', 'p']],
  ['stewards', ['p']],
  ['guarantees', ['p']],
  ['leaving', ['p']],
  ['changes', ['p']],
  ['law', ['p']],
  ['questions', ['p']]
], 7)

export const PRIVACY = build('agoraPrivacy', [
  ['intro', ['p']],
  ['who', ['p', 'p']],
  ['what', ['p', 6]],
  ['where', ['p', 'p']],
  ['others', ['p', 5, 'p']],
  ['meetings', ['p', 'p', 'p']],
  ['help', ['p']],
  ['ask', ['p', 'p', 'p']],
  ['contacts', ['p']],
  ['logs', ['p', 'p']],
  ['cookies', ['p', 3, 'p']],
  ['why', ['p']],
  ['see', [4]],
  ['retention', [5]],
  ['rights', ['p', 'p']],
  ['delete', ['p', 'p']],
  ['changes', ['p']]
], 12)

/** Every locale key the two pages use, for tests and for translators. */
export function allKeys (page) {
  const keys = [page.title]
  page.sections.forEach(section => {
    if (section.title) keys.push(section.title)
    section.blocks.forEach(block => keys.push(...(block.type === 'p' ? [block.key] : block.keys)))
  })
  return keys.concat(page.openPoints)
}

export const SHARED_KEYS = [
  'agoraLegal.draft',
  'agoraLegal.draftNote',
  'agoraLegal.version',
  'agoraLegal.openPoints',
  'agoraLegal.openPointsIntro',
  'agoraLegal.backToAgora'
]
