/**
 * Agora: Help (for members) and the Help desk (for the people who run Agora).
 * A small ticket system.
 *
 * A logged-in person opens the Help window (bottom right on every page) and
 * describes a fault, a wish or a question. That becomes a request in
 * agora_help_requests, with the page they were on, their browser, their
 * screen size and the version of Agora. Without a Claude key it is a plain
 * form. With ANTHROPIC_API_KEY set, the person may chat with Claude instead,
 * which answers how-to questions and files faults and wishes itself (see
 * helpClaude.js).
 *
 * Who may see what:
 *   - a request can be read only by the person who sent it and by Help desk
 *     admins. Everyone else is told it does not exist;
 *   - the internal note and the builder task are for admins only;
 *   - Help desk admins are listed in AGORA_HELPDESK_ADMINS (user ids, or
 *     email addresses of accounts whose address is confirmed). Without that
 *     setting nobody can open the Help desk.
 *
 * Settings (see .env.example):
 *   AGORA_HELPDESK_ADMINS        who runs the Help desk, e.g. "1,guy@example.org"
 *   AGORA_HELP_REQUESTS_PER_DAY  new requests per person per day (default 20)
 *   AGORA_HELP_REPLY_EMAIL       "off" sends no email when the Help desk replies
 *   AGORA_VERSION                the version stored with a request; default: the git commit
 */
import { execFileSync } from 'child_process'
import HelpClaude from './helpClaude'

const STATUSES = ['new', 'looking', 'building', 'fixed', 'wont_do']
const TYPES = ['fault', 'wish', 'question']
const URGENCIES = ['low', 'normal', 'urgent']

const MAX_TEXT = 5000
const MAX_REPLY = 5000
const MAX_NOTE = 10000
const MAX_TASK = 5000
const MEMBER_REPLIES_PER_HOUR = 30

class HelpError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

const knex = () => bookshelf.knex

/* ----------------------------------------------------------------------- */
/* Who is who                                                               */
/* ----------------------------------------------------------------------- */

function adminList () {
  return String(process.env.AGORA_HELPDESK_ADMINS || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * True for a Help desk admin: an active account whose id is in
 * AGORA_HELPDESK_ADMINS, or whose confirmed email address is.
 */
async function isAdmin (userId) {
  if (!userId) return false
  const list = adminList()
  if (list.length === 0) return false
  const user = await knex()('users').where({ id: userId }).first('id', 'email', 'active', 'email_validated')
  if (!user || user.active === false) return false
  if (list.includes(String(user.id))) return true
  return Boolean(user.email_validated && user.email && list.includes(String(user.email).toLowerCase()))
}

/* ----------------------------------------------------------------------- */
/* Checking what people send                                                */
/* ----------------------------------------------------------------------- */

function text (value, label, max, { required = false } = {}) {
  const v = value == null ? '' : String(value).trim()
  if (required && !v) throw new HelpError(400, `${label} is needed.`)
  if (v.length > max) throw new HelpError(400, `${label} is too long (at most ${max} characters).`)
  return v || null
}

function oneOf (value, list, fallback, label) {
  if (value == null || value === '') return fallback
  if (!list.includes(value)) throw new HelpError(400, `${label} is not valid.`)
  return value
}

function requestId (value) {
  if (!/^\d+$/.test(String(value || ''))) throw new HelpError(404, 'This request does not exist.')
  return String(value)
}

/** A web address without its query and hash, which can hold codes and tokens. */
function cleanPage (value) {
  if (!value) return null
  try {
    const url = new URL(String(value))
    if (!/^https?:$/.test(url.protocol)) return null
    return (url.origin + url.pathname).slice(0, 1000)
  } catch (e) {
    return null
  }
}

/** What the Help window records by itself: page, browser and screen. */
function cleanContext (context = {}) {
  const ua = context.userAgent == null ? '' : [...String(context.userAgent)].map(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch).join('').trim()
  const screen = context.screen == null ? '' : String(context.screen).replace(/[^0-9x@. ]/g, '').trim()
  return {
    page_url: cleanPage(context.page),
    user_agent: ua.slice(0, 500) || null,
    screen: screen.slice(0, 50) || null,
    app_version: appVersion()
  }
}

let cachedVersion
/** The version of Agora that is running: AGORA_VERSION, else the git commit, else nothing. */
function appVersion () {
  if (process.env.AGORA_VERSION) return String(process.env.AGORA_VERSION).slice(0, 64)
  if (cachedVersion === undefined) {
    try {
      cachedVersion = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
        .toString().trim().slice(0, 64) || null
    } catch (e) {
      cachedVersion = null
    }
  }
  return cachedVersion
}

/** A short title from the first line of what someone wrote. */
function titleFrom (value) {
  const first = String(value || '').split('\n').map(line => line.trim()).find(Boolean) || 'Help request'
  return first.length > 80 ? first.slice(0, 77).trimEnd() + '...' : first
}

/** A web address for the builder task link: http(s) only. */
function cleanLink (value) {
  const v = text(value, 'The link', 1000)
  if (!v) return null
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`
  try {
    const url = new URL(withScheme)
    if (!/^https?:$/.test(url.protocol)) throw new Error('scheme')
    return url.toString()
  } catch (e) {
    throw new HelpError(400, 'The link does not look like a web address.')
  }
}

async function checkDailyLimit (userId) {
  const perDay = Number(process.env.AGORA_HELP_REQUESTS_PER_DAY) || 20
  const row = await knex()('agora_help_requests')
    .where('user_id', userId)
    .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
    .count('id as n').first()
  if (Number(row.n) >= perDay) {
    throw new HelpError(429, 'You sent many requests today. Please wait until tomorrow, or add to one of your requests.')
  }
}

/* ----------------------------------------------------------------------- */
/* For the person who asks                                                  */
/* ----------------------------------------------------------------------- */

/** What the Help window needs to know when it opens. */
async function status (userId) {
  const unread = await knex()('agora_help_requests').where({ user_id: userId, unread_by_user: true }).count('id as n').first()
  return {
    claude: HelpClaude.available(),
    isAdmin: await isAdmin(userId),
    unread: Number(unread.n) || 0,
    types: TYPES,
    urgencies: URGENCIES,
    statuses: STATUSES
  }
}

/** Saves a request from the plain form. */
async function createFromForm (userId, input = {}) {
  const whatHappened = text(input.what_happened, 'What happened', MAX_TEXT, { required: true })
  const row = {
    user_id: userId,
    status: 'new',
    type: oneOf(input.type, TYPES, 'fault', 'The type'),
    urgency: oneOf(input.urgency, URGENCIES, 'normal', 'How urgent it is'),
    mode: 'form',
    title: text(input.title, 'The title', 200) || titleFrom(whatHappened),
    what_happened: whatHappened,
    what_expected: text(input.what_expected, 'What you expected', MAX_TEXT),
    ...cleanContext(input.context),
    unread_by_user: false,
    unread_by_desk: true,
    created_at: new Date(),
    updated_at: new Date()
  }
  await checkDailyLimit(userId)
  const [created] = await knex()('agora_help_requests').insert(row).returning('id')
  return String(created.id || created)
}

/** Saves a request that Claude filed from a chat. Called by chat() only. */
async function createFromChat (userId, filed, conversation, context, trx) {
  const row = {
    user_id: userId,
    status: 'new',
    type: TYPES.includes(filed.type) ? filed.type : 'fault',
    urgency: URGENCIES.includes(filed.urgency) ? filed.urgency : 'normal',
    mode: 'chat',
    title: titleFrom(filed.title).slice(0, 200),
    summary: String(filed.summary || '').slice(0, MAX_TEXT) || null,
    conversation: JSON.stringify(conversation),
    ...cleanContext(context),
    unread_by_user: false,
    unread_by_desk: true,
    created_at: new Date(),
    updated_at: new Date()
  }
  const [created] = await (trx || knex())('agora_help_requests').insert(row).returning('id')
  return String(created.id || created)
}

/** My own requests, newest first. */
async function listMine (userId) {
  const rows = await knex()('agora_help_requests')
    .where('user_id', userId)
    .orderBy('updated_at', 'desc')
    .limit(200)
    .select('id', 'title', 'type', 'urgency', 'status', 'created_at', 'updated_at', 'unread_by_user')
  return rows.map(r => ({ ...r, id: String(r.id), unread: r.unread_by_user, unread_by_user: undefined }))
}

async function repliesOf (id) {
  const rows = await knex()('agora_help_replies as r')
    .leftJoin('users as u', 'u.id', 'r.author_id')
    .where('r.request_id', id)
    .orderBy('r.created_at', 'asc')
    .orderBy('r.id', 'asc')
    .select('r.id', 'r.body', 'r.from_desk', 'r.created_at', 'u.name as author_name')
  return rows.map(r => ({ ...r, id: String(r.id) }))
}

function parseConversation (value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  try { return JSON.parse(value) } catch (e) { return [] }
}

/** One of my own requests, with the replies. Marks the replies as read. */
async function getMine (userId, rawId) {
  const id = requestId(rawId)
  const row = await knex()('agora_help_requests').where({ id, user_id: userId }).first()
  if (!row) throw new HelpError(404, 'This request does not exist.')
  if (row.unread_by_user) await knex()('agora_help_requests').where({ id }).update({ unread_by_user: false })
  return {
    id: String(row.id),
    title: row.title,
    type: row.type,
    urgency: row.urgency,
    status: row.status,
    mode: row.mode,
    summary: row.summary,
    what_happened: row.what_happened,
    what_expected: row.what_expected,
    conversation: parseConversation(row.conversation),
    page_url: row.page_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
    replies: await repliesOf(id)
  }
}

/** The person adds something to their own request. */
async function replyMine (userId, rawId, body) {
  const id = requestId(rawId)
  const message = text(body, 'Your message', MAX_REPLY, { required: true })
  const row = await knex()('agora_help_requests').where({ id, user_id: userId }).first('id')
  if (!row) throw new HelpError(404, 'This request does not exist.')
  const recent = await knex()('agora_help_replies as r')
    .join('agora_help_requests as q', 'q.id', 'r.request_id')
    .where({ 'q.user_id': userId, 'r.from_desk': false })
    .where('r.created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
    .count('r.id as n').first()
  if (Number(recent.n) >= MEMBER_REPLIES_PER_HOUR) {
    throw new HelpError(429, 'You sent many messages in the last hour. Please wait a little.')
  }
  await knex().transaction(async trx => {
    await trx('agora_help_replies').insert({ request_id: id, author_id: userId, from_desk: false, body: message, created_at: new Date() })
    await trx('agora_help_requests').where({ id }).update({ unread_by_desk: true, updated_at: new Date() })
  })
}

/* ----------------------------------------------------------------------- */
/* Chat with Claude                                                         */
/* ----------------------------------------------------------------------- */

const MAX_CHAT_TURNS = 8
const CHAT_KEEP_DAYS = 7
const chatTimes = new Map() // user id -> times of their recent chat messages

/** At most AGORA_HELP_CHAT_PER_HOUR chat messages per person per hour (default 30). */
function chatAllowed (userId, now = Date.now()) {
  const perHour = Number(process.env.AGORA_HELP_CHAT_PER_HOUR) || 30
  const recent = (chatTimes.get(String(userId)) || []).filter(t => now - t < 60 * 60 * 1000)
  if (recent.length >= perHour) {
    chatTimes.set(String(userId), recent)
    return false
  }
  recent.push(now)
  chatTimes.set(String(userId), recent)
  return true
}

function resetChatLimits () {
  chatTimes.clear()
}

/** The chat as people read it: who said what. Leaves out Claude's working. */
function readableConversation (messages) {
  const out = []
  for (const m of messages || []) {
    if (m.role === 'user') {
      const content = typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (content) out.push({ role: 'person', text: stripPageNote(content), at: m.at || null })
    } else if (m.role === 'assistant') {
      const content = (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      if (content) out.push({ role: 'claude', text: content, at: m.at || null })
    }
  }
  return out
}

const PAGE_NOTE = /^\[I am on the page [^\]\n]*\]\n\n/
function stripPageNote (value) {
  return String(value).replace(PAGE_NOTE, '')
}

/** For the API: the messages without our own "at" field. */
function forClaude (messages) {
  return messages.map(m => ({ role: m.role, content: m.content }))
}

/**
 * One message in a chat with Claude. Returns
 *   { chatId, reply, filed: { id, title } | null }
 * or { fallback: true, reason } when the plain form should be used instead:
 * no key, too many messages, a long chat, or Claude could not be reached.
 */
async function chat (userId, input = {}) {
  if (!HelpClaude.available()) return { fallback: true, reason: 'off' }
  const message = text(input.message, 'Your message', 4000, { required: true })
  if (!chatAllowed(userId)) return { fallback: true, reason: 'limit' }

  // Chats are only kept for a short while.
  await knex()('agora_help_chats').where('updated_at', '<', new Date(Date.now() - CHAT_KEEP_DAYS * 24 * 60 * 60 * 1000)).del()

  let chatRow = null
  if (input.chatId) {
    if (!/^\d+$/.test(String(input.chatId))) throw new HelpError(404, 'This chat does not exist.')
    chatRow = await knex()('agora_help_chats').where({ id: input.chatId, user_id: userId }).whereNull('request_id').first()
    if (!chatRow) throw new HelpError(404, 'This chat has ended. Start a new one.')
  }
  const messages = chatRow ? parseConversation(chatRow.messages) : []
  const context = input.context || {}

  if (messages.filter(m => m.role === 'user').length >= MAX_CHAT_TURNS) {
    return { fallback: true, reason: 'long' }
  }

  const page = cleanPage(context.page)
  const pagePath = page ? new URL(page).pathname : null
  const content = messages.length === 0 && pagePath ? `[I am on the page ${pagePath}]\n\n${message}` : message
  messages.push({ role: 'user', content, at: new Date().toISOString() })

  let answer
  try {
    answer = await HelpClaude.reply(forClaude(messages))
  } catch (err) {
    // Never log what the person wrote, only that it failed.
    console.error('Agora help: Claude could not answer:', err && (err.status || err.name || err.message))
    return { fallback: true, reason: 'error' }
  }
  if (!answer || answer.refused || (!answer.text && !answer.filed)) return { fallback: true, reason: 'error' }

  messages.push({ role: 'assistant', content: answer.content, at: new Date().toISOString() })

  return knex().transaction(async trx => {
    let chatId = chatRow && String(chatRow.id)
    if (chatId) {
      await trx('agora_help_chats').where({ id: chatId }).update({ messages: JSON.stringify(messages), updated_at: new Date() })
    } else {
      const [created] = await trx('agora_help_chats').insert({
        user_id: userId, messages: JSON.stringify(messages), created_at: new Date(), updated_at: new Date()
      }).returning('id')
      chatId = String(created.id || created)
    }

    let filed = null
    if (answer.filed) {
      await checkDailyLimit(userId)
      const id = await createFromChat(userId, answer.filed, readableConversation(messages), context, trx)
      await trx('agora_help_chats').where({ id: chatId }).update({ request_id: id })
      filed = { id, title: titleFrom(answer.filed.title) }
    }
    return { chatId, reply: answer.text || null, filed }
  })
}

/* ----------------------------------------------------------------------- */
/* For the Help desk                                                        */
/* ----------------------------------------------------------------------- */

async function requireAdmin (userId) {
  if (!(await isAdmin(userId))) throw new HelpError(403, 'The Help desk is for the people who run Agora.')
}

/** All requests, newest change first, optionally only one status or type. */
async function deskList (userId, { status: wantStatus, type } = {}) {
  await requireAdmin(userId)
  const q = knex()('agora_help_requests as q')
    .leftJoin('users as u', 'u.id', 'q.user_id')
    .orderBy('q.updated_at', 'desc')
    .limit(500)
    .select('q.id', 'q.title', 'q.type', 'q.urgency', 'q.status', 'q.mode', 'q.created_at', 'q.updated_at', 'q.unread_by_desk', 'u.name as user_name')
  if (wantStatus) q.where('q.status', oneOf(wantStatus, STATUSES, null, 'The status'))
  if (type) q.where('q.type', oneOf(type, TYPES, null, 'The type'))
  const rows = await q
  const counts = await knex()('agora_help_requests').select('status').count('id as n').groupBy('status')
  const byStatus = {}
  for (const s of STATUSES) byStatus[s] = 0
  for (const c of counts) byStatus[c.status] = Number(c.n)
  return {
    requests: rows.map(r => ({ ...r, id: String(r.id), unread: r.unread_by_desk, unread_by_desk: undefined })),
    counts: byStatus
  }
}

async function deskRow (rawId) {
  const id = requestId(rawId)
  const row = await knex()('agora_help_requests').where({ id }).first()
  if (!row) throw new HelpError(404, 'This request does not exist.')
  return row
}

/** One request with everything. Marks it as read by the Help desk. */
async function deskGet (userId, rawId) {
  await requireAdmin(userId)
  const row = await deskRow(rawId)
  if (row.unread_by_desk) await knex()('agora_help_requests').where({ id: row.id }).update({ unread_by_desk: false })
  const person = row.user_id
    ? await knex()('users').where({ id: row.user_id }).first('id', 'name', 'email')
    : null
  return {
    ...row,
    id: String(row.id),
    user_id: row.user_id && String(row.user_id),
    unread_by_desk: undefined,
    conversation: parseConversation(row.conversation),
    person: person ? { id: String(person.id), name: person.name, email: person.email } : null,
    replies: await repliesOf(row.id),
    claude: HelpClaude.available()
  }
}

/** Changes the status, the internal note, the builder task or its link. */
async function deskUpdate (userId, rawId, input = {}) {
  await requireAdmin(userId)
  const row = await deskRow(rawId)
  const changes = {}
  if (input.status !== undefined) {
    changes.status = oneOf(input.status, STATUSES, row.status, 'The status')
    if (changes.status !== row.status) changes.unread_by_user = true
  }
  if (input.internal_note !== undefined) changes.internal_note = text(input.internal_note, 'The note', MAX_NOTE)
  if (input.builder_task !== undefined) changes.builder_task = text(input.builder_task, 'The builder task', MAX_TASK)
  if (input.builder_task_link !== undefined) changes.builder_task_link = cleanLink(input.builder_task_link)
  if (Object.keys(changes).length === 0) return { id: String(row.id) }
  changes.updated_at = new Date()
  await knex()('agora_help_requests').where({ id: row.id }).update(changes)
  const warning = changes.builder_task ? await personalDetailsWarning(row, changes.builder_task) : null
  return { id: String(row.id), warning }
}

function appUrl (pathname) {
  const protocol = process.env.PROTOCOL || 'http'
  const domain = process.env.DOMAIN || 'localhost:3000'
  return `${protocol}://${domain}${pathname}`
}

/** The Help desk answers the person. They see it in their Help window and get an email. */
async function deskReply (userId, rawId, body, { sendEmail } = {}) {
  await requireAdmin(userId)
  const row = await deskRow(rawId)
  const message = text(body, 'The reply', MAX_REPLY, { required: true })
  await knex().transaction(async trx => {
    await trx('agora_help_replies').insert({ request_id: row.id, author_id: userId, from_desk: true, body: message, created_at: new Date() })
    await trx('agora_help_requests').where({ id: row.id }).update({ unread_by_user: true, updated_at: new Date() })
  })

  let emailed = false
  if (String(process.env.AGORA_HELP_REPLY_EMAIL || '').toLowerCase() !== 'off' && row.user_id) {
    const person = await knex()('users').where({ id: row.user_id }).first('email', 'name', 'active')
    if (person && person.email && person.active !== false) {
      const send = sendEmail || defaultSendEmail
      try {
        emailed = await send({
          email_id: 'agora_help_reply',
          recipient: { address: person.email },
          sender: { address: process.env.EMAIL_SENDER, name: process.env.AGORA_EMAIL_SENDER_NAME || 'Agora' },
          email_data: {
            title: row.title,
            reply: message,
            url: appUrl(`/?help=${row.id}`)
          }
        })
      } catch (err) {
        console.error('Agora help: the reply email could not be sent:', err && err.message)
        emailed = false
      }
    }
  }
  return { ok: true, emailed: Boolean(emailed) }
}

function defaultSendEmail (options) {
  const mailer = require('./mailer')
  return new Promise(resolve => mailer.send(options, (err, result) => resolve(!err && Boolean(result) && !(result && result.skipped))))
}

/** Words that would name the person: their name, its parts and their email address. */
async function personalWords (row) {
  if (!row.user_id) return []
  const person = await knex()('users').where({ id: row.user_id }).first('name', 'email')
  if (!person) return []
  const words = new Set()
  if (person.email) {
    words.add(person.email)
    words.add(person.email.split('@')[0])
  }
  if (person.name) {
    words.add(person.name)
    for (const part of person.name.split(/\s+/)) if (part.length >= 3) words.add(part)
  }
  return [...words].filter(w => w && w.length >= 3)
}

function escapeRegExp (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Finds a whole word, also one with letters such as é or ø. */
function wordPattern (word, flags) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, flags + 'u')
}

/** Replaces the person's name and email address with "the member". */
function scrub (value, words) {
  let out = String(value || '')
  for (const word of [...words].sort((a, b) => b.length - a.length)) {
    out = out.replace(wordPattern(word, 'gi'), 'the member')
  }
  return out
}

async function personalDetailsWarning (row, task) {
  const words = await personalWords(row)
  const found = words.some(w => wordPattern(w, 'i').test(task))
  return found ? 'The task seems to name the person. Builder tasks should not hold names or personal details.' : null
}

/**
 * "Build this": marks the request as building and stores a short task for a
 * builder, without names or personal details. With `task` given, that text is
 * stored. Without it, Claude writes one, but only for a request that came
 * from a chat with Claude (the person agreed to Claude reading it), and only
 * with the person's name and email address taken out first.
 */
async function deskBuild (userId, rawId, { task } = {}) {
  await requireAdmin(userId)
  const row = await deskRow(rawId)
  let written = text(task, 'The builder task', MAX_TASK)
  let by = 'admin'
  if (!written) {
    if (!HelpClaude.available()) throw new HelpError(400, 'Type the builder task yourself: there is no Claude key.')
    if (row.mode !== 'chat') {
      throw new HelpError(400, 'Type the builder task yourself: this request came from the plain form, so its text does not go to Claude.')
    }
    const words = await personalWords(row)
    const conversation = parseConversation(row.conversation).map(m => ({ role: m.role, text: scrub(m.text, words) }))
    try {
      written = await HelpClaude.builderTask({
        type: row.type,
        title: scrub(row.title, words),
        summary: scrub(row.summary, words),
        page: row.page_url ? new URL(row.page_url).pathname : null,
        conversation
      })
    } catch (err) {
      console.error('Agora help: Claude could not write the builder task:', err && (err.status || err.name || err.message))
      throw new HelpError(502, 'Claude could not write the task just now. Type it yourself, or try again later.')
    }
    written = scrub(text(written, 'The builder task', MAX_TASK * 2) || '', words).slice(0, MAX_TASK)
    if (!written) throw new HelpError(502, 'Claude could not write the task just now. Type it yourself, or try again later.')
    by = 'claude'
  }
  const changes = { builder_task: written, updated_at: new Date() }
  if (row.status !== 'building') {
    changes.status = 'building'
    changes.unread_by_user = true
  }
  await knex()('agora_help_requests').where({ id: row.id }).update(changes)
  return { id: String(row.id), builder_task: written, by, warning: await personalDetailsWarning(row, written) }
}

module.exports = {
  STATUSES,
  TYPES,
  URGENCIES,
  HelpError,
  isAdmin,
  status,
  createFromForm,
  listMine,
  getMine,
  replyMine,
  chat,
  deskList,
  deskGet,
  deskUpdate,
  deskReply,
  deskBuild,
  // for tests
  cleanContext,
  readableConversation,
  scrub,
  resetChatLimits
}
