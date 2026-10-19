import crypto from 'crypto'

/**
 * Agora: guests in a meeting, people without an Agora account.
 *
 * A member who may edit an event makes a guest link for it. The link carries
 * a long random secret. Agora keeps only its sha256 hash (in
 * meeting_guest_links), so even someone who reads the database cannot rebuild
 * a working link. A guest who joins gets a second secret of their own (its
 * hash is in meeting_guests), so one guest cannot send speech in another
 * guest's name.
 *
 * Guests can join the call, have their own speech turned into text if they
 * agree, and leave. They can never read the transcript, see anything else in
 * Agora, or end the meeting for everyone.
 */

// 32 random bytes, written in base64url: always 43 letters, digits, "-" or "_".
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const NAME_MAX = 60
// Letters (any alphabet), digits, spaces and . ' ’ -; starting with a letter or digit.
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’-]*$/u
const GRACE_AFTER_END_MS = 2 * 60 * 60 * 1000
const EVENT_LENGTH_IF_UNKNOWN_MS = 60 * 60 * 1000
const MAX_GUESTS_PER_MEETING = 50
// Compared against when no link exists, so a missing link takes as long as a wrong one.
const NO_HASH = '0'.repeat(64)

function newSecret () {
  return crypto.randomBytes(32).toString('base64url')
}

function hashSecret (secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex')
}

function isSecret (value) {
  return typeof value === 'string' && SECRET_PATTERN.test(value)
}

/** Compares two sha256 hashes in constant time. */
function sameHash (a, b) {
  if (!HASH_PATTERN.test(String(a)) || !HASH_PATTERN.test(String(b))) return false
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/**
 * The name a guest gave, tidied up, or null when it cannot be used.
 * Short, and only letters, digits, spaces and a few marks, because it is shown
 * in the call, in the notes and in the minutes, and read by the assistant.
 */
function cleanName (raw) {
  if (typeof raw !== 'string') return null
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (name.length < 1 || name.length > NAME_MAX) return null
  if (!NAME_PATTERN.test(name)) return null
  return name
}

/** How a guest is named in the room, the notes and the minutes. */
function guestLabel (name) {
  return `${name} (guest)`
}

/**
 * When a new guest link stops working: two hours after the event ends.
 * An event without an end time is taken to last an hour; one without any
 * time gets a day from now.
 */
function defaultExpiry (post, now = new Date()) {
  const end = post.get('end_time')
  const start = post.get('start_time')
  let endsAt
  if (end) endsAt = new Date(end).getTime()
  else if (start) endsAt = new Date(start).getTime() + EVENT_LENGTH_IF_UNKNOWN_MS
  else return new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return new Date(endsAt + GRACE_AFTER_END_MS)
}

/**
 * Whether this person may make or revoke the guest link of this event: the
 * person who made the event, or a steward of one of its circles (someone
 * with Administration or Manage Content there, the same check Hylo uses for
 * moderating posts).
 */
async function canManageGuestLink (userId, post) {
  if (!userId || !post) return false
  if (String(post.get('user_id')) === String(userId)) return true
  await post.load('groups')
  const groups = post.relations.groups?.models || []
  const { RESP_ADMINISTRATION, RESP_MANAGE_CONTENT } = Responsibility.constants
  for (const group of groups) {
    const responsibilities = await Responsibility.fetchForUserAndGroupAsStrings(userId, group.id)
    if (responsibilities.includes(RESP_ADMINISTRATION) || responsibilities.includes(RESP_MANAGE_CONTENT)) return true
  }
  return false
}

/** The guest link row of an event, if any. */
function findLink (postId) {
  return bookshelf.knex('meeting_guest_links').where({ post_id: postId }).first()
}

/**
 * Makes a new guest link for an event, replacing an earlier one.
 * Returns the secret, which is shown once and never stored.
 */
async function createLink ({ post, userId, now = new Date() }) {
  const secret = newSecret()
  const expiresAt = defaultExpiry(post, now)
  const fields = {
    token_hash: hashSecret(secret),
    created_by_id: userId,
    expires_at: expiresAt,
    revoked_at: null,
    updated_at: now
  }
  const existing = await findLink(post.id)
  if (existing) {
    await bookshelf.knex('meeting_guest_links').where({ id: existing.id }).update(fields)
    await releaseGuests(existing.id, now)
  } else {
    await bookshelf.knex('meeting_guest_links').insert({ post_id: post.id, created_at: now, ...fields })
  }
  return { secret, expiresAt }
}

/**
 * Guests who came in through a link that was replaced or closed are no longer
 * tied to it, so their own secret stops working too.
 */
function releaseGuests (linkId, now = new Date()) {
  return bookshelf.knex('meeting_guests')
    .where({ link_id: linkId })
    .update({ link_id: null, left_at: bookshelf.knex.raw('coalesce(left_at, ?)', [now]) })
}

async function revokeLink (postId) {
  const now = new Date()
  const existing = await findLink(postId)
  if (!existing) return 0
  await releaseGuests(existing.id, now)
  return bookshelf.knex('meeting_guest_links')
    .where({ id: existing.id })
    .whereNull('revoked_at')
    .update({ revoked_at: now, updated_at: now })
}

/**
 * Checks a guest link's secret.
 * @returns {Promise<{link: object|null, reason: string|null}>} reason is
 *   'invalid' (no such link, or a wrong secret), 'revoked' or 'expired'.
 */
async function checkLink (postId, secret) {
  if (!isSecret(secret)) return { link: null, reason: 'invalid' }
  const row = await findLink(postId)
  const matches = sameHash(hashSecret(secret), row ? row.token_hash : NO_HASH)
  if (!row || !matches) return { link: null, reason: 'invalid' }
  if (row.revoked_at) return { link: null, reason: 'revoked' }
  if (new Date(row.expires_at).getTime() <= Date.now()) return { link: null, reason: 'expired' }
  return { link: row, reason: null }
}

/** Records a guest who joined. Returns the guest row and their own secret. */
async function addGuest ({ sessionId, linkId, name, notesConsent }) {
  const key = newSecret()
  const [row] = await bookshelf.knex('meeting_guests').insert({
    session_id: sessionId,
    link_id: linkId,
    name,
    key_hash: hashSecret(key),
    notes_consent: !!notesConsent,
    joined_at: new Date()
  }).returning('*')
  return { guest: row, key }
}

function countGuests (sessionId) {
  return bookshelf.knex('meeting_guests').where({ session_id: sessionId }).count('id as count').first()
    .then(r => Number(r.count))
}

/**
 * Finds the guest behind a guest's own secret, for this link only.
 * Returns null when the id, the secret or the link do not match.
 */
async function findGuest ({ guestId, key, linkId }) {
  if (!/^\d{1,18}$/.test(String(guestId || '')) || !isSecret(key)) return null
  const row = await bookshelf.knex('meeting_guests').where({ id: guestId }).first()
  const matches = sameHash(hashSecret(key), row ? row.key_hash : NO_HASH)
  if (!row || !matches || String(row.link_id) !== String(linkId)) return null
  return row
}

/**
 * A small counter per address and per kind of call, kept in memory. Agora's
 * server runs as one program, so this is enough to slow down someone trying
 * links or flooding a meeting.
 */
function createRateLimiter () {
  const hits = new Map()
  return {
    /** True while `key` has been used fewer than `limit` times in the last `windowMs`. */
    allow (key, limit, windowMs) {
      const now = Date.now()
      if (hits.size > 20000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
      }
      let entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs }
        hits.set(key, entry)
      }
      entry.count += 1
      return entry.count <= limit
    },
    /** True when `key` is already over `limit`, without counting this call. */
    over (key, limit) {
      const entry = hits.get(key)
      return !!entry && entry.resetAt > Date.now() && entry.count > limit
    },
    reset () { hits.clear() }
  }
}

const rateLimiter = createRateLimiter()

// Calls per minute, per address (or per guest, for calls made during the meeting).
const LIMITS = {
  page: 30,
  join: 10,
  joinPerLink: 60, // all guests of one meeting together
  segment: 60, // a piece of speech is at least 3 seconds long, so about 20 a minute is normal
  status: 40, // the guest's page asks every 4 seconds
  leave: 10
}
// Wrong or old links, per address, before that address is refused for a while.
const FAILED_LIMIT = 20
const FAILED_WINDOW_MS = 10 * 60 * 1000

module.exports = {
  MAX_GUESTS_PER_MEETING,
  NAME_MAX,
  LIMITS,
  FAILED_LIMIT,
  FAILED_WINDOW_MS,
  newSecret,
  hashSecret,
  isSecret,
  sameHash,
  cleanName,
  guestLabel,
  defaultExpiry,
  canManageGuestLink,
  findLink,
  createLink,
  revokeLink,
  checkLink,
  addGuest,
  countGuests,
  findGuest,
  createRateLimiter,
  rateLimiter
}
