import { guestLabel, rateLimiter } from './meetingGuests'

/**
 * Agora: the chat next to the call, who is still in a meeting, the overview
 * on the end screen, and when a meeting that nobody ended ends by itself.
 *
 * Used by the member room (api/controllers/MeetingController.js), the guest
 * room (api/controllers/MeetingGuestController.js) and MeetingSession.
 *
 * The chat is plain text, saved with the meeting session, and only shown to
 * people who are in that meeting. When the meeting ends, the messages go into
 * the minutes post, under "Chat during the meeting".
 */

const TEXT_MAX = 1000
const MESSAGES_PER_MINUTE = 20
const MESSAGES_PER_PERSON_PER_MEETING = 500
const MESSAGES_PER_ANSWER = 200
// Someone whose room page has not said "still here" for this long is shown as gone.
const HERE_WITHIN_MS = 90 * 1000
// A meeting ends by itself once nobody has been in it for this long ...
const EMPTY_FOR_MS = 10 * 60 * 1000
// ... and at the latest this long after the event's end time.
const AFTER_EVENT_END_MS = 2 * 60 * 60 * 1000
const EVENT_LENGTH_IF_UNKNOWN_MS = 60 * 60 * 1000

/**
 * A chat message, tidied up, or null when it cannot be used: not text, empty,
 * or longer than TEXT_MAX. Control characters go; line breaks stay (at most
 * two in a row).
 */
function cleanText (raw) {
  if (typeof raw !== 'string') return null
  const text = raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length < 1 || text.length > TEXT_MAX) return null
  return text
}

/**
 * Saves one chat message by a member ({ userId }) or a guest ({ guestId }).
 * The caller has checked that this person is in the open meeting.
 * @returns {Promise<{message?: object, error?: string, status?: number}>}
 */
async function postMessage ({ sessionId, userId = null, guestId = null, text }) {
  const clean = cleanText(text)
  if (!clean) return { status: 400, error: `A message is plain text, at most ${TEXT_MAX} characters.` }

  const who = userId ? `user-${userId}` : `guest-${guestId}`
  if (!rateLimiter.allow(`chat:${who}`, MESSAGES_PER_MINUTE, 60000)) {
    return { status: 429, error: 'You are sending messages very fast. Wait a moment.' }
  }
  const speaker = userId ? { user_id: userId } : { guest_id: guestId }
  const count = await bookshelf.knex('meeting_chat_messages')
    .where({ session_id: sessionId, ...speaker })
    .count('id as count')
    .first()
  if (Number(count.count) >= MESSAGES_PER_PERSON_PER_MEETING) {
    return { status: 429, error: 'You have sent as many messages as one meeting can take.' }
  }

  const [row] = await bookshelf.knex('meeting_chat_messages').insert({
    session_id: sessionId,
    ...speaker,
    text: clean,
    created_at: new Date()
  }).returning('id')
  const id = row && typeof row === 'object' ? row.id : row
  const [message] = await listMessages(sessionId, { afterId: String(Number(id) - 1), limit: 1 })
  return { message }
}

/**
 * The chat of a meeting, oldest first. A message by a guest has guest: true
 * and a name ending in "(guest)". `userId` and `guestId` are for the server
 * only (to mark someone's own messages); never send them to a page as they are.
 * @returns {Promise<Array<{id, name, text, at, guest, userId, guestId}>>}
 */
async function listMessages (sessionId, { afterId = null, limit = MESSAGES_PER_ANSWER } = {}) {
  const rows = await bookshelf.knex('meeting_chat_messages')
    .leftJoin('users', 'users.id', 'meeting_chat_messages.user_id')
    .leftJoin('meeting_guests', 'meeting_guests.id', 'meeting_chat_messages.guest_id')
    .where('meeting_chat_messages.session_id', sessionId)
    .modify(q => {
      if (afterId && /^\d{1,18}$/.test(String(afterId))) q.where('meeting_chat_messages.id', '>', afterId)
      if (limit) q.limit(limit)
    })
    .orderBy('meeting_chat_messages.id', 'asc')
    .select(
      'meeting_chat_messages.id',
      'meeting_chat_messages.user_id',
      'meeting_chat_messages.guest_id',
      'meeting_chat_messages.text',
      'meeting_chat_messages.created_at',
      'users.name',
      'meeting_guests.name as guest_name'
    )
  return rows.map(r => ({
    id: String(r.id),
    name: r.guest_id ? guestLabel(r.guest_name) : r.name,
    text: r.text,
    at: r.created_at,
    guest: !!r.guest_id,
    userId: r.user_id ? String(r.user_id) : null,
    guestId: r.guest_id ? String(r.guest_id) : null
  }))
}

/** What a page may see of a message: no ids of people, only whether it is the reader's own. */
function forPage (messages, { userId = null, guestId = null } = {}) {
  return messages.map(m => ({
    id: m.id,
    name: m.name,
    text: m.text,
    at: m.at,
    guest: m.guest,
    mine: (userId && m.userId === String(userId)) || (guestId && m.guestId === String(guestId)) || false
  }))
}

/** The room page of a member says "still here". */
function memberSeen (sessionId, userId, now = new Date()) {
  return bookshelf.knex('meeting_participants')
    .where({ session_id: sessionId, user_id: userId })
    .update({ last_seen_at: now, left_at: null })
}

/** The room page of a guest says "still here". */
function guestSeen (guestId, now = new Date()) {
  return bookshelf.knex('meeting_guests')
    .where({ id: guestId })
    .whereNull('left_at')
    .update({ last_seen_at: now })
}

/** A member pressed Leave, or closed the page. The meeting goes on. */
function memberLeft (sessionId, userId, now = new Date()) {
  return bookshelf.knex('meeting_participants')
    .where({ session_id: sessionId, user_id: userId })
    .update({ left_at: now, last_seen_at: now })
}

/** Whether a row of meeting_participants or meeting_guests is in the call right now. */
function isHere (row, now = Date.now()) {
  if (row.left_at) return false
  const seen = row.last_seen_at || row.joined_at
  return !!seen && now - new Date(seen).getTime() < HERE_WITHIN_MS
}

/**
 * Everyone who took part in a meeting: members first, then guests (each
 * guest name once, ending in "(guest)").
 */
async function whoTookPart (sessionId) {
  const members = await bookshelf.knex('meeting_participants')
    .join('users', 'users.id', 'meeting_participants.user_id')
    .where('meeting_participants.session_id', sessionId)
    .orderBy('meeting_participants.joined_at', 'asc')
    .select('users.name')
  const guestRows = await bookshelf.knex('meeting_guests')
    .where({ session_id: sessionId })
    .orderBy('joined_at', 'asc')
    .select('name')
  return {
    members: members.map(r => r.name),
    guests: [...new Set(guestRows.map(r => guestLabel(r.name)))]
  }
}

/**
 * The overview on the end screen. No transcript text and no links: the
 * member's page adds the minutes link itself.
 */
async function summary (session, post) {
  const group = post.relations.groups && post.relations.groups.first()
  const { members, guests } = await whoTookPart(session.id)
  const noted = await bookshelf.knex('meeting_segments')
    .where({ session_id: session.id })
    .whereIn('status', [MeetingSegment.Status.DONE, MeetingSegment.Status.PENDING])
    .count('id as count')
    .first()
  const chat = await bookshelf.knex('meeting_chat_messages')
    .where({ session_id: session.id })
    .count('id as count')
    .first()
  const startedAt = session.get('started_at')
  const endedAt = session.get('ended_at')
  return {
    status: session.get('status'),
    title: post.get('name') || 'Meeting',
    groupName: group ? group.get('name') : '',
    startedAt,
    endedAt: endedAt || null,
    durationMs: Math.max(0, new Date(endedAt || Date.now()).getTime() - new Date(startedAt).getTime()),
    people: members.map(name => ({ name, guest: false })).concat(guests.map(name => ({ name, guest: true }))),
    notesTaken: Number(noted.count) > 0,
    chatMessages: Number(chat.count)
  }
}

/**
 * The latest moment an open meeting may run until: two hours after the
 * event's end time. A meeting started after that (a room opened again for an
 * old event) gets two hours from its start instead.
 */
function latestEnd (post, session) {
  const started = new Date(session.get('started_at')).getTime()
  const end = post.get('end_time')
  const start = post.get('start_time')
  let eventEnd
  if (end) eventEnd = new Date(end).getTime()
  else if (start) eventEnd = new Date(start).getTime() + EVENT_LENGTH_IF_UNKNOWN_MS
  else eventEnd = started + EVENT_LENGTH_IF_UNKNOWN_MS
  return new Date(Math.max(eventEnd, started) + AFTER_EVENT_END_MS)
}

/** The last moment anybody was in this meeting (joined, said "still here", or spoke). */
async function lastPresence (session) {
  const times = [session.get('started_at'), session.get('last_activity_at')]
  const member = await bookshelf.knex('meeting_participants')
    .where({ session_id: session.id })
    .max({ seen: bookshelf.knex.raw('coalesce(last_seen_at, joined_at)') })
    .first()
  const guest = await bookshelf.knex('meeting_guests')
    .where({ session_id: session.id })
    .max({ seen: bookshelf.knex.raw('coalesce(last_seen_at, joined_at)') })
    .first()
  times.push(member && member.seen, guest && guest.seen)
  return new Date(Math.max(...times.filter(Boolean).map(t => new Date(t).getTime())))
}

/**
 * Why an open meeting should end by itself now, or null when it should go on.
 * 'empty': nobody has been in it for 10 minutes. 'late': it is 2 hours past
 * the event's end time.
 */
async function reasonToEnd (session, post, now = new Date()) {
  if (now.getTime() >= latestEnd(post, session).getTime()) return 'late'
  const last = await lastPresence(session)
  if (now.getTime() - last.getTime() >= EMPTY_FOR_MS) return 'empty'
  return null
}

module.exports = {
  TEXT_MAX,
  MESSAGES_PER_MINUTE,
  HERE_WITHIN_MS,
  EMPTY_FOR_MS,
  AFTER_EVENT_END_MS,
  cleanText,
  postMessage,
  listMessages,
  forPage,
  memberSeen,
  guestSeen,
  memberLeft,
  isHere,
  whoTookPart,
  summary,
  latestEnd,
  lastPresence,
  reasonToEnd
}
