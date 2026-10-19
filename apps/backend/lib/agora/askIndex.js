/**
 * Agora: the knowledge index behind the Ask tab (table agora_knowledge_chunks).
 *
 * Each circle's posts, comments, chat, proposals with their votes, events,
 * playbook chapters, meeting transcripts and minutes, and the texts read
 * from its files are cut into short pieces ("chunks"). Each piece gets a
 * keyword index (Postgres full-text search) and, when Infomaniak's AI is set
 * up, an embedding: a list of numbers that stands for its meaning, so Ask
 * also finds pieces that say the same thing in other words.
 *
 * What may go in is decided by lib/agora/askPermissions.js. Private message
 * threads never go in.
 *
 * The background worker keeps the index fresh: a job after a post or
 * comment is made, changed or removed (api/services/AgoraAsk.js), and a
 * catch-up every 10 minutes (cron.js) for anything those jobs missed. A full
 * rebuild: scripts/agora-ask-reindex.js.
 *
 * Settings:
 *   AGORA_ASK_VECTOR   "off" never uses pgvector, even when the database has it
 */
import crypto from 'crypto'
import { TextHelpers } from '@hylo/shared'
import AI from './infomaniakAI'
import { indexableGroupIds } from './askPermissions'

const CHUNK_CHARS = 1500
const CHUNK_OVERLAP = 200
const MAX_SOURCE_CHARS = 120000 // a very long transcript is cut here
const MAX_EMBED_CHARS = 6000 // well under the 8192 tokens Infomaniak takes per text
const EMBED_PER_RUN = 400

const knex = () => bookshelf.knex
const log = (level, message) => { if (typeof sails !== 'undefined') sails.log[level](`Agora Ask: ${message}`) }

/* ----------------------------------------------------------------------- */
/* Text                                                                     */
/* ----------------------------------------------------------------------- */

export function htmlToText (html) {
  if (!html) return ''
  let text
  try {
    text = TextHelpers.presentHTMLToText(String(html), { providedConvertHtmlToTextOptions: { wordwrap: false } })
  } catch (e) {
    text = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  }
  return cleanText(text)
}

export function cleanText (text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Cuts a text into pieces of about CHUNK_CHARS characters, at a paragraph or
 * sentence end when there is one, with a little overlap so a sentence that
 * falls on the edge is found from both sides.
 */
export function chunkText (text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = cleanText(text).slice(0, MAX_SOURCE_CHARS)
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const chunks = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size)
    if (end < clean.length) {
      const window = clean.slice(start + Math.floor(size / 2), end)
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
      if (cut > 0) end = start + Math.floor(size / 2) + cut + 1
    }
    chunks.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks.filter(Boolean)
}

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex')
const day = date => date ? new Date(date).toISOString().slice(0, 10) : ''

export function postUrl (post, groupSlug) {
  if (post.type === 'chat') return `/groups/${groupSlug}/chat?postId=${post.id}`
  return `/groups/${groupSlug}/post/${post.id}`
}

/* ----------------------------------------------------------------------- */
/* Writing pieces                                                           */
/* ----------------------------------------------------------------------- */

/**
 * The rows for one source in one circle.
 * @param {object} source { groupId, sourceType, sourceKey, sourceId, postId, title, url, authorId, createdAt, text }
 */
export function rowsFor (source) {
  return chunkText(source.text).map((text, i) => ({
    group_id: source.groupId,
    source_type: source.sourceType,
    source_key: source.sourceKey,
    source_id: source.sourceId || null,
    post_id: source.postId || null,
    title: source.title ? String(source.title).slice(0, 500) : null,
    url: source.url || null,
    author_id: source.authorId || null,
    created_at: source.createdAt || null,
    chunk_index: i,
    text,
    text_hash: hash(`${source.title || ''}\n${text}`)
  }))
}

/**
 * Replaces the pieces chosen by `where` (a function on a knex query) with
 * `rows`. Embeddings of pieces whose text did not change are kept, so
 * editing one comment does not pay for embedding a whole thread again.
 */
export async function replaceRows (where, rows) {
  const model = AI.embedModel()
  return knex().transaction(async trx => {
    const existing = await trx('agora_knowledge_chunks').where(where).whereNotNull('embedding')
      .where('embed_model', model).select('text_hash', 'embedding')
    const kept = new Map(existing.map(r => [r.text_hash, r.embedding]))
    await trx('agora_knowledge_chunks').where(where).del()
    if (!rows.length) return 0
    const now = new Date()
    const insert = rows.map(r => {
      const embedding = kept.get(r.text_hash)
      return { ...r, indexed_at: now, embedding: embedding || null, embed_model: embedding ? model : null }
    })
    for (let i = 0; i < insert.length; i += 200) {
      await trx('agora_knowledge_chunks').insert(insert.slice(i, i + 200))
    }
    return insert.length
  })
}

async function groupsOfPost (postId) {
  return knex()('groups_posts as gp').join('groups as g', 'g.id', 'gp.group_id')
    .where('gp.post_id', postId).select('g.id', 'g.slug', 'g.active')
}

async function namesOf (userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const rows = await knex()('users').whereIn('id', ids).select('id', 'name')
  return new Map(rows.map(r => [String(r.id), r.name || 'Someone']))
}

/* ----------------------------------------------------------------------- */
/* Posts and their comments                                                 */
/* ----------------------------------------------------------------------- */

async function proposalText (post) {
  const options = await knex()('proposal_options').where('post_id', post.id).orderBy('id').select('id', 'text', 'emoji')
  if (!options.length) return ''
  const votes = await knex()('proposal_votes as v').leftJoin('users as u', 'u.id', 'v.user_id')
    .where('v.post_id', post.id).select('v.option_id', 'u.name')
  const anonymous = !!post.anonymous_voting && post.anonymous_voting !== 'false'
  const lines = options.map(o => {
    const voters = votes.filter(v => String(v.option_id) === String(o.id))
    const who = !anonymous && voters.length ? `: ${voters.map(v => v.name || 'someone').join(', ')}` : ''
    return `- ${[o.emoji, o.text].filter(Boolean).join(' ')} (${voters.length} ${voters.length === 1 ? 'vote' : 'votes'}${who})`
  })
  const status = [post.proposal_status && `Status: ${post.proposal_status}`, post.proposal_outcome && `Outcome: ${post.proposal_outcome}`]
    .filter(Boolean).join('. ')
  return `${status ? status + '.\n' : ''}Options and votes${anonymous ? ' (anonymous voting)' : ''}:\n${lines.join('\n')}`
}

function eventText (post) {
  const parts = []
  if (post.start_time) parts.push(`Starts: ${new Date(post.start_time).toISOString().replace('T', ' ').slice(0, 16)} UTC`)
  if (post.end_time) parts.push(`Ends: ${new Date(post.end_time).toISOString().replace('T', ' ').slice(0, 16)} UTC`)
  if (post.location) parts.push(`Where: ${post.location}`)
  return parts.join('. ')
}

async function sourceTypeOf (post) {
  const minutes = await knex()('meeting_sessions').where('minutes_post_id', post.id).first('id')
  if (minutes) return 'meeting'
  if (post.type === 'chat') return 'chat'
  if (post.type === 'event') return 'event'
  if (post.type === 'proposal') return 'proposal'
  return 'post'
}

/** Indexes one post and its comments again, in every circle it may be in. */
export async function indexPost (postId) {
  if (!/^\d+$/.test(String(postId || ''))) return 0
  const where = q => q.where('post_id', postId).whereNot('source_type', 'private_theme')
  const post = await knex()('posts').where('id', postId).first()
  const groups = post ? await groupsOfPost(postId) : []
  const groupIds = post ? indexableGroupIds(post, groups) : []
  if (!groupIds.length) return replaceRows(where, [])

  const comments = await knex()('comments').where('post_id', postId).where('active', true)
    .orderBy('created_at', 'asc').select('id', 'user_id', 'text', 'created_at')
  const names = await namesOf([post.user_id, ...comments.map(c => c.user_id)])
  const media = await knex()('media').where('post_id', postId).whereNotNull('name').select('name')

  const sourceType = await sourceTypeOf(post)
  const title = post.name || (sourceType === 'chat' ? 'Chat message' : 'Post')
  const author = names.get(String(post.user_id))
  const body = [
    author ? `By ${author}, ${day(post.created_at)}.` : day(post.created_at),
    post.type === 'event' ? eventText(post) : '',
    post.type === 'proposal' ? await proposalText(post) : '',
    htmlToText(post.description),
    media.length ? `Attached: ${media.map(m => m.name).join(', ')}` : ''
  ].filter(Boolean).join('\n')

  const rows = []
  for (const group of groups.filter(g => groupIds.includes(String(g.id)))) {
    const url = postUrl(post, group.slug)
    rows.push(...rowsFor({
      groupId: group.id,
      sourceType,
      sourceKey: `post:${post.id}`,
      sourceId: post.id,
      postId: post.id,
      title,
      url,
      authorId: post.user_id,
      createdAt: post.created_at,
      text: body
    }))
    for (const c of comments) {
      const text = htmlToText(c.text)
      if (!text) continue
      rows.push(...rowsFor({
        groupId: group.id,
        sourceType: 'comment',
        sourceKey: `comment:${c.id}`,
        sourceId: c.id,
        postId: post.id,
        title: `Comment on: ${title}`,
        url,
        authorId: c.user_id,
        createdAt: c.created_at,
        text: `${names.get(String(c.user_id)) || 'Someone'} wrote on ${day(c.created_at)}: ${text}`
      }))
    }
  }
  return replaceRows(where, rows)
}

export async function removePost (postId) {
  if (!/^\d+$/.test(String(postId || ''))) return 0
  return replaceRows(q => q.where('post_id', postId).whereNot('source_type', 'private_theme'), [])
}

/* ----------------------------------------------------------------------- */
/* Playbook, meetings, files                                                */
/* ----------------------------------------------------------------------- */

export async function indexPlaybook (groupId) {
  const where = q => q.where('group_id', groupId).where('source_type', 'playbook')
  const group = await knex()('groups').where('id', groupId).first('id', 'slug', 'active')
  if (!group || group.active === false) return replaceRows(where, [])
  const chapters = await knex()('agora_playbook_chapters').where('group_id', groupId).orderBy('position')
  const names = await namesOf(chapters.flatMap(c => [c.owner_id, c.updated_by_id]))
  const rows = chapters.flatMap(c => rowsFor({
    groupId,
    sourceType: 'playbook',
    sourceKey: `playbook:${c.id}`,
    sourceId: c.id,
    title: `Playbook chapter ${c.position}: ${c.title}`,
    url: `/groups/${group.slug}/playbook`,
    authorId: c.updated_by_id || c.created_by_id,
    createdAt: c.updated_at || c.created_at,
    text: [
      `Chapter ${c.position} of the playbook: ${c.title}.`,
      `Owner: ${c.owner_id ? names.get(String(c.owner_id)) : 'nobody yet'}. Status: ${String(c.status || '').replace('_', ' ')}.`,
      c.updated_at ? `Last changed ${day(c.updated_at)}${c.updated_by_id ? ' by ' + names.get(String(c.updated_by_id)) : ''}.` : '',
      c.summary || '',
      c.link ? `Link: ${c.link}` : ''
    ].filter(Boolean).join('\n')
  }))
  return replaceRows(where, rows)
}

/**
 * A meeting's transcript, from the meeting tables. Once the minutes are
 * posted, that post (with the transcript in it) is indexed as a meeting
 * instead, so the transcript is not in the index twice.
 */
export async function indexMeetingSession (sessionId) {
  const key = `meeting:${sessionId}`
  const where = q => q.where('source_key', key)
  const session = await knex()('meeting_sessions').where('id', sessionId).first()
  if (!session) return replaceRows(where, [])
  if (session.minutes_post_id) {
    const minutes = await knex()('posts').where('id', session.minutes_post_id).first('id', 'active')
    if (minutes && minutes.active !== false) return replaceRows(where, [])
  }
  const event = await knex()('posts').where('id', session.post_id).first()
  const groups = event ? await groupsOfPost(event.id) : []
  const groupIds = event ? indexableGroupIds(event, groups) : []
  if (!groupIds.length) return replaceRows(where, [])
  const lines = await knex()('meeting_segments as s').leftJoin('users as u', 'u.id', 's.user_id')
    .where('s.session_id', sessionId).whereNotNull('s.text').whereNot('s.text', '')
    .orderBy('s.spoken_at', 'asc').select('u.name', 's.text')
  if (!lines.length) return replaceRows(where, [])
  const date = day(session.started_at || session.created_at)
  const text = `Transcript of the meeting "${event.name || 'Meeting'}" on ${date}.\n` +
    lines.map(l => `${l.name || 'Someone'}: ${l.text}`).join('\n')
  const rows = groups.filter(g => groupIds.includes(String(g.id))).flatMap(g => rowsFor({
    groupId: g.id,
    sourceType: 'meeting',
    sourceKey: key,
    sourceId: session.id,
    title: `Meeting: ${event.name || 'Meeting'} (${date})`,
    url: postUrl(event, g.slug),
    createdAt: session.started_at || session.created_at,
    text
  }))
  return replaceRows(where, rows)
}

let fileTextsTable = { checkedAt: 0, exists: false }
/** agora_file_texts is made by the library work (lib/agora/fileTexts.js). Until it exists, files are skipped. */
export async function fileTextsAvailable () {
  if (Date.now() - fileTextsTable.checkedAt > 60000) {
    fileTextsTable = { checkedAt: Date.now(), exists: await knex().schema.hasTable('agora_file_texts') }
  }
  return fileTextsTable.exists
}

const UNFINISHED = ['pending', 'processing', 'queued', 'error', 'failed']

/** One row of agora_file_texts: a document, picture, recording or meeting read into text. */
export async function indexFileText (fileTextId) {
  const key = `file:${fileTextId}`
  const where = q => q.where('source_key', key)
  if (!(await fileTextsAvailable())) return 0
  const row = await knex()('agora_file_texts').where('id', fileTextId).first()
  if (!row || !row.text || UNFINISHED.includes(String(row.status || '').toLowerCase())) return replaceRows(where, [])

  let targets = [] // [{ group, url }]
  if (row.post_id) {
    const post = await knex()('posts').where('id', row.post_id).first()
    const groups = post ? await groupsOfPost(post.id) : []
    const ids = post ? indexableGroupIds(post, groups) : []
    targets = groups.filter(g => ids.includes(String(g.id)))
      .filter(g => !row.group_id || String(g.id) === String(row.group_id))
      .map(g => ({ group: g, url: postUrl(post, g.slug) }))
  } else if (row.group_id) {
    const group = await knex()('groups').where('id', row.group_id).first('id', 'slug', 'active')
    if (group && group.active !== false) targets = [{ group, url: `/groups/${group.slug}` }]
  }
  const kind = String(row.kind || 'document').toLowerCase()
  const rows = targets.flatMap(({ group, url }) => rowsFor({
    groupId: group.id,
    sourceType: kind === 'meeting' ? 'meeting' : 'file',
    sourceKey: key,
    sourceId: row.id,
    postId: row.post_id || null,
    title: row.title || (kind === 'meeting' ? 'Meeting' : 'File'),
    url,
    createdAt: row.created_at,
    text: row.text
  }))
  return replaceRows(where, rows)
}

/* ----------------------------------------------------------------------- */
/* Embeddings                                                               */
/* ----------------------------------------------------------------------- */

let vectorCache = { checkedAt: 0, ready: false }
/** True when the database has pgvector and it is not switched off. */
export async function vectorReady () {
  if (String(process.env.AGORA_ASK_VECTOR || '').toLowerCase() === 'off') return false
  if (Date.now() - vectorCache.checkedAt > 60000) {
    let ready = false
    try {
      const result = await knex().raw("select 1 from pg_extension where extname = 'vector'")
      ready = result.rows.length > 0
    } catch (e) {
      ready = false
    }
    vectorCache = { checkedAt: Date.now(), ready }
  }
  return vectorCache.ready
}

export function forgetVectorCheck () {
  vectorCache = { checkedAt: 0, ready: false }
  fileTextsTable = { checkedAt: 0, exists: false }
}

export function embedInput (row) {
  return `${row.title ? row.title + '\n' : ''}${row.text}`.slice(0, MAX_EMBED_CHARS)
}

/**
 * Gives embeddings to pieces that have none (or one from another model).
 * Does nothing without Infomaniak's AI, or when this month's cap is reached.
 * @returns {Promise<number>} how many pieces got one
 */
export async function embedMissing ({ limit = EMBED_PER_RUN } = {}) {
  if (!AI.isConfigured()) return 0
  const model = AI.embedModel()
  let done = 0
  while (done < limit) {
    if (await AI.capReached()) {
      log('warn', 'the monthly spend cap is reached; new pieces get no embedding until next month')
      break
    }
    const rows = await knex()('agora_knowledge_chunks')
      .where(q => q.whereNull('embedding').orWhereNot('embed_model', model).orWhereNull('embed_model'))
      .orderBy('id', 'desc').limit(Math.min(32, limit - done)).select('id', 'title', 'text')
    if (!rows.length) break
    let result
    try {
      result = await AI.embed(rows.map(embedInput), model)
    } catch (err) {
      log('error', `embedding failed, keyword search still works: ${err.message}`)
      break
    }
    await AI.recordUsage({ kind: 'embed', model, inputTokens: result.tokens || Math.ceil(rows.reduce((n, r) => n + embedInput(r).length, 0) / 4) })
    for (let i = 0; i < rows.length; i++) {
      await knex()('agora_knowledge_chunks').where('id', rows[i].id).update({ embedding: result.vectors[i], embed_model: model })
    }
    done += rows.length
  }
  return done
}

/* ----------------------------------------------------------------------- */
/* Catching up and rebuilding                                               */
/* ----------------------------------------------------------------------- */

export async function getState (key) {
  const row = await knex()('agora_ask_state').where('key', key).first('value')
  return row ? row.value : null
}

export async function setState (key, value) {
  await knex().raw(
    'insert into agora_ask_state (key, value, updated_at) values (?, ?, now()) on conflict (key) do update set value = excluded.value, updated_at = now()',
    [key, value == null ? null : String(value)]
  )
}

/** Everything that changed since the last catch-up, plus pieces still without an embedding. */
export async function catchUp ({ now = new Date() } = {}) {
  const last = await getState('index_watermark')
  if (!last) {
    const counts = await reindexAll()
    await setState('index_watermark', now.toISOString())
    return counts
  }
  // A little overlap, so a change made while the last run was busy is not missed.
  const since = new Date(new Date(last).getTime() - 60000)

  const postIds = await knex()('posts')
    .whereRaw('greatest(created_at, updated_at, edited_at, deactivated_at) > ?', [since])
    .where(q => q.whereNull('type').orWhereNot('type', 'thread')).pluck('id')
  const commentPostIds = await knex()('comments as c').join('posts as p', 'p.id', 'c.post_id')
    .whereRaw('greatest(c.created_at, c.edited_at, c.deactivated_at) > ?', [since])
    .where(q => q.whereNull('p.type').orWhereNot('p.type', 'thread')).distinct().pluck('c.post_id')
  const voted = await knex()('proposal_votes').where('created_at', '>', since).distinct().pluck('post_id')
  const ids = [...new Set([...postIds, ...commentPostIds, ...voted].map(String))]
  for (const id of ids) await indexPost(id)

  const playbookGroups = await knex()('agora_playbook_chapters').where('updated_at', '>', since).distinct().pluck('group_id')
  for (const id of playbookGroups) await indexPlaybook(id)

  const sessions = await knex()('meeting_sessions').where('updated_at', '>', since).pluck('id')
  for (const id of sessions) await indexMeetingSession(id)

  let files = []
  if (await fileTextsAvailable()) {
    files = await knex()('agora_file_texts').where('updated_at', '>', since).pluck('id')
    for (const id of files) await indexFileText(id)
  }

  const embedded = await embedMissing()
  await setState('index_watermark', now.toISOString())
  return { posts: ids.length, playbooks: playbookGroups.length, meetings: sessions.length, files: files.length, embedded }
}

/**
 * Builds the whole index again (or one circle's part of it). Pieces whose
 * text did not change keep their embedding.
 */
export async function reindexAll ({ groupId = null, embed = true } = {}) {
  const inGroup = q => { if (groupId) q.where('group_id', groupId) }
  const postIds = new Set((await knex()('groups_posts').modify(inGroup).distinct().pluck('post_id')).map(String))
  for (const id of await knex()('agora_knowledge_chunks').modify(inGroup).whereNotNull('post_id').distinct().pluck('post_id')) {
    postIds.add(String(id)) // posts that left the index since: their pieces go
  }
  for (const id of postIds) await indexPost(id)

  const groupIds = groupId ? [groupId] : await knex()('groups').pluck('id')
  for (const id of groupIds) await indexPlaybook(id)

  const sessionQuery = knex()('meeting_sessions')
  if (groupId) sessionQuery.whereIn('post_id', knex()('groups_posts').where('group_id', groupId).select('post_id'))
  const sessions = await sessionQuery.pluck('id')
  for (const id of sessions) await indexMeetingSession(id)

  let files = 0
  if (await fileTextsAvailable()) {
    const fileQuery = knex()('agora_file_texts')
    if (groupId) fileQuery.where('group_id', groupId)
    const fileIds = await fileQuery.pluck('id')
    for (const id of fileIds) await indexFileText(id)
    files = fileIds.length
    // Pieces of file texts that were removed
    const known = new Set(fileIds.map(id => `file:${id}`))
    const stale = (await knex()('agora_knowledge_chunks').modify(inGroup).where('source_key', 'like', 'file:%').distinct().pluck('source_key'))
      .filter(key => !known.has(key))
    if (stale.length && !groupId) await knex()('agora_knowledge_chunks').whereIn('source_key', stale).del()
  }

  let embedded = 0
  if (embed) {
    let n
    do {
      n = await embedMissing()
      embedded += n
    } while (n >= EMBED_PER_RUN)
  }
  return { posts: postIds.size, playbooks: groupIds.length, meetings: sessions.length, files, embedded }
}

export default {
  htmlToText,
  cleanText,
  chunkText,
  postUrl,
  rowsFor,
  replaceRows,
  indexPost,
  removePost,
  indexPlaybook,
  indexMeetingSession,
  indexFileText,
  fileTextsAvailable,
  vectorReady,
  forgetVectorCheck,
  embedInput,
  embedMissing,
  getState,
  setState,
  catchUp,
  reindexAll
}
