/**
 * Agora: the text read from the files in a circle's library.
 *
 * One table, agora_file_texts, holds the text of every document, picture,
 * sound recording and meeting in a circle's library. The library search reads
 * it, and so will the AI "Ask" tab (built on the branch agora-ask). That is
 * why its shape is a contract: change it only together with the Ask feature.
 *
 *   id          a number that only goes up
 *   group_id    the circle
 *   post_id     the library item (a Hylo "resource" post)
 *   media_id    the attachment (Hylo's media table) the text came from; empty for a meeting without one
 *   kind        document | image | audio | meeting
 *   title       a name to show, such as the file name or "Meeting notes: <event> (<date>)"
 *   text        the text itself (empty while pending, or when nothing could be read)
 *   language    a language code such as "en" when it is known, else empty
 *   status      pending | done | failed | too_big
 *   error       why it failed or was too big, in plain words
 *   created_at, updated_at
 *
 * There is at most one current row per file: per (post_id, media_id, kind).
 * When the text or status of a file changes, its old row is removed and a new
 * row with a new, higher id takes its place. So a reader that remembers the
 * highest id it has seen gets every new result with listForGroup(groupId, thatId),
 * and when it gets a row it should drop any row it kept for the same
 * (post_id, media_id, kind).
 */

export const KINDS = ['document', 'image', 'audio', 'meeting']
export const STATUSES = ['pending', 'done', 'failed', 'too_big']

// Postgres keeps up to 1 GB in a text column, but a search over many such texts
// would be slow. Five million characters is about 2,500 pages.
export const MAX_TEXT_CHARS = 5000000

const knex = () => bookshelf.knex

function cleanText (text) {
  if (text === null || text === undefined) return ''
  // Postgres refuses the NUL character in text.
  let value = String(text).split(String.fromCharCode(0)).join('')
  if (value.length > MAX_TEXT_CHARS) value = value.slice(0, MAX_TEXT_CHARS) + '\n\n[The text was cut off here: it was too long.]'
  return value
}

function sameFile (q, { postId, mediaId, kind }) {
  q.where({ post_id: postId, kind })
  if (mediaId) q.where({ media_id: mediaId })
  else q.whereNull('media_id')
  return q
}

/** The current row for one file, or null. */
export async function findText ({ postId, mediaId = null, kind }) {
  const row = await sameFile(knex()('agora_file_texts'), { postId, mediaId, kind }).orderBy('id', 'desc').first()
  return row || null
}

/**
 * Saves the text of one file (or one meeting), replacing what was saved before.
 *
 * @param {object} args
 * @param {string|number} args.groupId
 * @param {string|number} args.postId
 * @param {string|number} [args.mediaId]
 * @param {'document'|'image'|'audio'|'meeting'} args.kind
 * @param {string} [args.title]
 * @param {string} [args.text]
 * @param {string} [args.language]
 * @param {'pending'|'done'|'failed'|'too_big'} [args.status] default 'done'
 * @param {string} [args.error]
 * @returns {Promise<object>} the saved row
 */
export async function saveText ({ groupId, postId, mediaId = null, kind, title = null, text = '', language = null, status = 'done', error = null }) {
  if (!groupId) throw new Error('saveText needs a groupId')
  if (!postId) throw new Error('saveText needs a postId')
  if (!KINDS.includes(kind)) throw new Error(`saveText: unknown kind "${kind}"`)
  if (!STATUSES.includes(status)) throw new Error(`saveText: unknown status "${status}"`)

  const now = new Date()
  const values = {
    group_id: groupId,
    post_id: postId,
    media_id: mediaId || null,
    kind,
    title: title ? String(title).slice(0, 500) : null,
    text: cleanText(text),
    language: language ? String(language).slice(0, 20) : null,
    status,
    error: error ? String(error).slice(0, 2000) : null
  }

  return bookshelf.transaction(async trx => {
    const old = await sameFile(trx('agora_file_texts'), { postId, mediaId, kind }).orderBy('id', 'desc')
    const current = old[0]
    // Nothing that a reader cares about changed: keep the row and its id.
    if (current && old.length === 1 && current.status === values.status && current.text === values.text &&
        current.title === values.title && current.language === values.language && current.error === values.error &&
        String(current.group_id) === String(values.group_id)) {
      await trx('agora_file_texts').where({ id: current.id }).update({ updated_at: now })
      return { ...current, updated_at: now }
    }
    if (old.length) await trx('agora_file_texts').whereIn('id', old.map(r => r.id)).del()
    const [row] = await trx('agora_file_texts')
      .insert({ ...values, created_at: current ? current.created_at : now, updated_at: now })
      .returning('*')
    return row
  })
}

/**
 * The texts of a circle with an id above sinceId, oldest first.
 * @param {string|number} groupId
 * @param {string|number} [sinceId] 0 or empty for all
 * @param {object} [options] { limit } default 500, at most 5000
 */
export async function listForGroup (groupId, sinceId = 0, { limit = 500 } = {}) {
  return knex()('agora_file_texts')
    .where({ group_id: groupId })
    .where('id', '>', Number(sinceId) || 0)
    .orderBy('id', 'asc')
    .limit(Math.min(Math.max(Number(limit) || 500, 1), 5000))
}

/** Every current text of one library item. */
export async function listForPost (postId) {
  return knex()('agora_file_texts').where({ post_id: postId }).orderBy('id', 'asc')
}

export default { KINDS, STATUSES, MAX_TEXT_CHARS, saveText, listForGroup, listForPost, findText }
