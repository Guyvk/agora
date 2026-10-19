/**
 * Agora: what Ask may learn from private messages, and how. The whole policy
 * is in this file.
 *
 * Guy's rule (19 October 2026): "Info from private chats can be used to
 * inform ideas and work. Never to share full or even one message unredacted
 * from individuals."
 *
 * So:
 *   1. The text of a private message (a comment in one of Hylo's direct
 *      message threads) never goes into the knowledge index, and never into
 *      the prompt that answers a question. Not for anyone, also not for the
 *      people who wrote it: they read their own messages in Messages.
 *   2. Once a day (and when an admin asks), a background step turns recent
 *      private messages into anonymised THEMES: short general statements of
 *      topics, ideas, concerns and suggestions, such as "Several members find
 *      the travel cost reimbursement process unclear". Before anything goes
 *      to Infomaniak's AI, names of members, email addresses, phone numbers,
 *      web addresses and @mentions are taken out, and people are called
 *      "Person 1", "Person 2" and so on.
 *   3. A theme is kept only when it comes from at least two different people,
 *      or is clearly about the work and not personal.
 *   4. Every theme is checked twice before it is stored: a fixed check takes
 *      out email addresses, phone numbers, web addresses, @mentions, names of
 *      Agora members and anything in quotation marks, and drops the theme if
 *      it still copies more than six words in a row from any private message;
 *      then the AI is asked whether the theme could identify a person or
 *      reveal a specific message. If so, or if that check fails, it is dropped.
 *   5. Themes are stored in agora_private_themes without any link to the
 *      messages or people they came from, and indexed only in circles that the
 *      people in those conversations share. Answers cite them only as
 *      "From private conversations (anonymised)", without a link.
 *   6. The answering prompt tells the model never to quote or attribute a
 *      theme, and every answer is checked afterwards: a sentence that copies
 *      more than six words in a row from a private message the asker did not
 *      write is removed (scrubAnswer).
 *
 * Settings:
 *   AGORA_ASK_PRIVATE_THEMES   on (default) or off. Off: no themes are made,
 *                              existing ones are removed from the index, and
 *                              answers never use them. The answer check stays.
 *   AGORA_ASK_THEMES_DAYS      how many days of private messages are read (default 90)
 */
import AI from './infomaniakAI'
import { privateThemesOn } from './askPermissions'
import { replaceRows, rowsFor, htmlToText } from './askIndex'

export const THEME_LABEL = 'From private conversations (anonymised)'
const MAX_COPIED_WORDS = 6 // seven words in a row copied from a message is too many
const BATCH_CHARS = 24000
const MAX_THEMES_PER_BATCH = 12

const knex = () => bookshelf.knex
const log = (level, message) => { if (typeof sails !== 'undefined') sails.log[level](`Agora Ask themes: ${message}`) }

/* ----------------------------------------------------------------------- */
/* Fixed (deterministic) checks                                             */
/* ----------------------------------------------------------------------- */

const EMAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi
const WEB_ADDRESS = /\b(?:https?:\/\/|www\.)\S+/gi
const PHONE = /(?:\+|\b00)?\d[\d\s().-]{6,}\d/g
const MENTION = /@[\p{L}\p{N}_.-]+/gu
const QUOTED = /["“”„«»][^"“”„«»]{0,400}["“”„«»]|(?:^|\s)'[^']{3,400}'(?=\s|[.,;:!?]|$)/g

/** Words of a text, lower case, without punctuation, for comparing. */
export function words (text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
}

function shingles (list, n = MAX_COPIED_WORDS + 1) {
  const out = new Set()
  for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(' '))
  return out
}

/** True when `text` copies more than six words in a row from `source`. */
export function copiesFrom (text, source) {
  const mine = shingles(words(text))
  if (!mine.size) return false
  for (const s of shingles(words(source))) if (mine.has(s)) return true
  return false
}

/**
 * The names to take out: every member's full name and each capitalised part
 * of it of three letters or more. Matched as whole words, with the capital
 * letter, so "guy" in a sentence stays but "Guy" goes.
 */
export function namePatterns (names) {
  const parts = new Set()
  for (const name of names || []) {
    const full = String(name || '').trim()
    if (!full) continue
    parts.add(full)
    for (const part of full.split(/[\s-]+/)) if (part.length >= 3 && /^\p{Lu}/u.test(part)) parts.add(part)
  }
  const escaped = [...parts].sort((a, b) => b.length - a.length).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'gu')
}

/** Takes out email addresses, web addresses, phone numbers, @mentions and names. */
export function redactText (text, namesRegex, { replacement = 'someone' } = {}) {
  let out = String(text || '')
    .replace(EMAIL, '[email]')
    .replace(WEB_ADDRESS, '[link]')
    .replace(MENTION, replacement)
    .replace(PHONE, '[number]')
  if (namesRegex) out = out.replace(namesRegex, replacement)
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * The fixed check on a theme. Returns the cleaned theme, or null when it must
 * be dropped.
 */
export function cleanTheme (theme, { namesRegex, messages = [] } = {}) {
  let text = String(theme || '').replace(QUOTED, ' ')
  text = redactText(text, namesRegex, { replacement: 'a member' })
    .replace(/\[(email|link|number)\]/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (words(text).length < 4) return null
  if (text.length > 400) return null
  for (const message of messages) if (copiesFrom(text, message)) return null
  return text
}

/* ----------------------------------------------------------------------- */
/* Reading private messages                                                 */
/* ----------------------------------------------------------------------- */

async function memberNames () {
  return knex()('users').whereNotNull('name').pluck('name')
}

/** Recent messages of private threads, with their thread and author. Only used inside this file. */
async function recentPrivateMessages (days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await knex()('comments as c').join('posts as p', 'p.id', 'c.post_id')
    .where('p.type', 'thread').where('c.active', true).where('c.created_at', '>', since)
    .whereNotNull('c.text')
    .orderBy(['c.post_id', 'c.created_at'])
    .select('c.post_id as thread_id', 'c.user_id', 'c.text')
  return rows.map(r => ({ ...r, text: htmlToText(r.text) })).filter(r => r.text)
}

async function sharedCircles (userIds) {
  if (!userIds.length) return []
  const rows = await knex()('group_memberships as gm').join('groups as g', 'g.id', 'gm.group_id')
    .whereIn('gm.user_id', userIds).where('gm.active', true).where('g.active', true)
    .groupBy('g.id', 'g.name').havingRaw('count(distinct gm.user_id) = ?', [userIds.length])
    .select('g.id', 'g.name')
  return rows.map(r => ({ id: String(r.id), name: r.name }))
}

const THEMES_PROMPT = `You help a volunteer movement learn from its members' private conversations without exposing anyone.
You get excerpts of private conversations. People are called Person 1, Person 2 and so on; names, addresses and numbers were removed.
Write the main THEMES: topics, ideas, concerns and suggestions about the work of the movement and its circles.

Rules for every theme:
- One short, general sentence, such as "Several members find the travel cost reimbursement process unclear".
- No names, no "Person 1", no quotes, no dates of messages, no unique phrases, no roles or details that point to one person.
- Leave out anything personal (health, family, relationships, money troubles, conflicts between people).
- Write in English.

Answer with one JSON object and nothing else:
{"themes": [{"theme": "the sentence", "people": ["Person 1", "Person 4"], "circles": ["circle id", ...], "about_work": true}]}
"people" lists who it came from. "circles" lists ids from the circles given with the conversations it came from, only when the theme is clearly about that circle's work; otherwise an empty list. "about_work" is true only when it is clearly about the work and not personal.
At most ${MAX_THEMES_PER_BATCH} themes. Use {"themes": []} when there is nothing.`

const CHECK_PROMPT = `You check statements before they are shown to members of a volunteer movement.
A statement must be general. It must not identify a person, and must not reveal what one specific message said.
Answer with one JSON object and nothing else: {"identifies": true} if the statement could identify a person (directly or by details such as a role, place, date or a unique situation) or reveals a specific message, otherwise {"identifies": false}.`

function parseJson (text) {
  const raw = String(text || '').replace(/^```(?:json)?\s*|```\s*$/g, '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch (e) {
    return null
  }
}

/**
 * Builds the anonymised excerpts for the AI, in batches. People get a number
 * for this run only; it is not stored.
 */
export function buildBatches (threads, namesRegex) {
  const pseudonyms = new Map()
  const personOf = id => {
    if (!pseudonyms.has(String(id))) pseudonyms.set(String(id), `Person ${pseudonyms.size + 1}`)
    return pseudonyms.get(String(id))
  }
  const batches = []
  let current = { text: '', threads: [] }
  threads.forEach((thread, i) => {
    const circles = thread.circles.length
      ? `Circles they share: ${thread.circles.map(c => `${c.id} (${c.name})`).join(', ')}`
      : 'Circles they share: none'
    const lines = thread.messages.map(m => `${personOf(m.user_id)}: ${redactText(m.text, namesRegex)}`)
    const block = `Conversation ${i + 1}. ${circles}\n${lines.join('\n')}\n\n`
    if (current.text && current.text.length + block.length > BATCH_CHARS) {
      batches.push(current)
      current = { text: '', threads: [] }
    }
    current.text += block.slice(0, BATCH_CHARS)
    current.threads.push({ circles: thread.circles.map(c => c.id), people: [...new Set(thread.messages.map(m => personOf(m.user_id)))] })
  })
  if (current.text) batches.push(current)
  return batches
}

/** Whether a theme is kept: two or more different people, or clearly about the work. */
export function keepTheme ({ sourceCount, aboutWork }) {
  return sourceCount >= 2 || aboutWork === true
}

/* ----------------------------------------------------------------------- */
/* Making the themes                                                        */
/* ----------------------------------------------------------------------- */

/**
 * Makes the themes again from recent private messages, replaces the stored
 * ones and indexes them in their circles.
 * @returns {Promise<{ themes: number, dropped: number, skipped?: string }>}
 */
export async function refreshThemes () {
  if (!privateThemesOn()) {
    await clearThemes()
    return { themes: 0, dropped: 0, skipped: 'off' }
  }
  if (!AI.isConfigured()) return { themes: 0, dropped: 0, skipped: 'no AI' }
  if (await AI.capReached()) return { themes: 0, dropped: 0, skipped: 'cap' }

  const days = Number(process.env.AGORA_ASK_THEMES_DAYS) || 90
  const rows = await recentPrivateMessages(days)
  const byThread = new Map()
  for (const row of rows) {
    if (!byThread.has(row.thread_id)) byThread.set(row.thread_id, [])
    byThread.get(row.thread_id).push(row)
  }
  const threads = []
  for (const messages of byThread.values()) {
    const people = [...new Set(messages.map(m => String(m.user_id)))]
    threads.push({ messages, circles: await sharedCircles(people) })
  }
  const namesRegex = namePatterns(await memberNames())
  const messageTexts = rows.map(r => r.text)

  const found = []
  let dropped = 0
  for (const batch of buildBatches(threads, namesRegex)) {
    let result
    try {
      result = await AI.chat({
        messages: [{ role: 'system', content: THEMES_PROMPT }, { role: 'user', content: batch.text }],
        maxTokens: 1200,
        temperature: 0.1
      })
    } catch (err) {
      log('error', `could not make themes: ${err.message}`)
      continue
    }
    await AI.recordUsage({ kind: 'themes', model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
    const parsed = parseJson(result.text)
    for (const item of (parsed && Array.isArray(parsed.themes) ? parsed.themes : []).slice(0, MAX_THEMES_PER_BATCH)) {
      const people = [...new Set((Array.isArray(item.people) ? item.people : []).map(String))]
        .filter(p => batch.threads.some(t => t.people.includes(p)))
      const sourceCount = people.length
      if (!keepTheme({ sourceCount, aboutWork: item.about_work })) { dropped++; continue }
      // Circles: only those shared by the people of a conversation the theme came from.
      const allowed = new Set(batch.threads.filter(t => t.people.some(p => people.includes(p))).flatMap(t => t.circles))
      const circles = [...new Set((Array.isArray(item.circles) ? item.circles : []).map(String))].filter(id => allowed.has(id))
      const theme = cleanTheme(item.theme, { namesRegex, messages: messageTexts })
      if (!theme) { dropped++; continue }
      if (!(await passesAICheck(theme))) { dropped++; continue }
      found.push({ theme, circles, sourceCount })
    }
  }

  await knex().transaction(async trx => {
    await trx('agora_private_themes').del()
    const now = new Date()
    for (const t of found) {
      await trx('agora_private_themes').insert({ theme: t.theme, group_ids: t.circles, source_count: t.sourceCount, created_at: now, updated_at: now })
    }
  })
  await indexThemes()
  return { themes: found.length, dropped }
}

async function passesAICheck (theme) {
  try {
    const result = await AI.chat({
      messages: [{ role: 'system', content: CHECK_PROMPT }, { role: 'user', content: theme }],
      maxTokens: 30,
      temperature: 0
    })
    await AI.recordUsage({ kind: 'themes', model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
    const parsed = parseJson(result.text)
    return !!parsed && parsed.identifies === false
  } catch (err) {
    log('error', `the check of a theme failed, so it is dropped: ${err.message}`)
    return false
  }
}

/** Puts the stored themes into the index of their circles (and only there). */
export async function indexThemes () {
  const where = q => q.where('source_type', 'private_theme')
  if (!privateThemesOn()) return replaceRows(where, [])
  const themes = await knex()('agora_private_themes').select('id', 'theme', 'group_ids', 'created_at')
  const activeGroups = new Set((await knex()('groups').where('active', true).pluck('id')).map(String))
  const rows = themes.flatMap(t => (t.group_ids || []).map(String).filter(id => activeGroups.has(id)).flatMap(groupId => rowsFor({
    groupId,
    sourceType: 'private_theme',
    sourceKey: `private_theme:${t.id}`,
    sourceId: t.id,
    title: THEME_LABEL,
    url: null,
    createdAt: t.created_at,
    text: t.theme
  })))
  return replaceRows(where, rows)
}

export async function clearThemes () {
  await knex()('agora_private_themes').del()
  await replaceRows(q => q.where('source_type', 'private_theme'), [])
}

/* ----------------------------------------------------------------------- */
/* The check on every answer                                                */
/* ----------------------------------------------------------------------- */

function sentences (text) {
  return String(text || '').match(/[^.!?\n]+(?:[.!?]+|\n|$)\s*/g) || []
}

/**
 * Removes every sentence of an answer that copies more than six words in a
 * row from a private message the asker did not write.
 * @returns {Promise<{ text: string, removed: number }>}
 */
export async function scrubAnswer (answer, askerId) {
  const text = String(answer || '')
  const answerShingles = shingles(words(text))
  if (!answerShingles.size) return { text, removed: 0 }
  const messages = await knex()('comments as c').join('posts as p', 'p.id', 'c.post_id')
    .where('p.type', 'thread')
    .whereNot('c.user_id', askerId || 0)
    .whereNotNull('c.text')
    .pluck('c.text')
  const copied = new Set()
  for (const message of messages) {
    for (const s of shingles(words(htmlToText(message)))) if (answerShingles.has(s)) copied.add(s)
  }
  if (!copied.size) return { text, removed: 0 }
  let removed = 0
  const kept = sentences(text).filter(sentence => {
    const own = shingles(words(sentence))
    for (const s of own) {
      if (copied.has(s)) { removed++; return false }
    }
    return true
  })
  let out = kept.join('').trim()
  // A copy that runs across two sentences: drop both sides.
  if (shingles(words(out)).size && [...shingles(words(out))].some(s => copied.has(s))) {
    out = ''
    removed++
  }
  return { text: out, removed }
}

export default {
  THEME_LABEL,
  words,
  copiesFrom,
  namePatterns,
  redactText,
  cleanTheme,
  buildBatches,
  keepTheme,
  refreshThemes,
  indexThemes,
  clearThemes,
  scrubAnswer
}
