/**
 * Agora: one calendar for each person, and a calendar feed to subscribe to.
 *
 * What a person's calendar holds (the page at /calendar in the web app, and
 * the feed, which hold exactly the same):
 * - every Meeting and Event of every circle (group, also spaces) the person
 *   is an active member of;
 * - every Meeting and Event marked "for all of 7BP" (lib/agora/eventKinds.js),
 *   wherever it was posted;
 * - nothing from people the person blocked, or who blocked them;
 * - never a Meeting or Event of a circle the person is not in, unless it is
 *   for all of 7BP. Being public does not put an Event in anyone's calendar.
 *
 * The calendar feed is an iCalendar (.ics) address that Google Calendar,
 * Apple Calendar and Outlook can subscribe to. It is served live from the
 * server at /noo/agora/calendar/<secret>.ics, so it is always current; no
 * file is written. The secret is 32 random bytes, one per person, made only
 * when the person asks for a link. Making a new one replaces the old one,
 * which then stops working; the person can also switch the link off.
 * The secret is kept as it is (not as a hash) so the page can show the link
 * again: whoever can read the database can read the calendar itself anyway.
 * The server's request log hides it (config/http.js).
 *
 * "Also send everyone a calendar invitation by email": for a new Meeting or
 * Event for all of 7BP, every active Agora member gets an email with the
 * calendar file attached (inviteEveryone, run as a background job).
 */
import crypto from 'crypto'
import ical from 'ical-generator'
import { DateTimeHelpers } from '@hylo/shared'
import { kindOf, MEETING, EVENT, canMarkForAll, mainGroup } from './eventKinds'
import { meetingRoomUrl } from './meetingLink'

const { plainText } = require('./mailer')

export const MAX_ITEMS = 1000
// The feed holds what starts up to 2 years ahead and what ended up to 90 days ago.
const FEED_PAST_DAYS = 90
const FEED_FUTURE_DAYS = 730
// The page asks for one month (or a few weeks around it) at a time.
const MAX_RANGE_DAYS = 400

function knex () {
  return bookshelf.knex
}

function appUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

function roomEnabled () {
  return Boolean((process.env.AGORA_MEET_DOMAIN || '').trim())
}

export class CalendarError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

/* ---------- What is in a person's calendar ---------- */

/**
 * The Meetings and Events in a person's calendar that overlap the time from
 * `from` to `to` (Dates), soonest first.
 */
export async function itemsFor (userId, { from, to, limit = MAX_ITEMS } = {}) {
  if (!userId) return []
  const k = knex()
  const myGroupIds = k('group_memberships')
    .join('groups', 'groups.id', 'group_memberships.group_id')
    .where({ 'group_memberships.user_id': userId, 'group_memberships.active': true, 'groups.active': true })
    .select('groups.id')

  const rows = await k('posts')
    .where('posts.type', 'event')
    .where('posts.active', true)
    .whereNotNull('posts.start_time')
    .where('posts.start_time', '<', to)
    .where(q => q.where('posts.end_time', '>=', from).orWhere(q2 => q2.whereNull('posts.end_time').where('posts.start_time', '>=', from)))
    .where(q => q
      .where('posts.agora_for_all', true)
      .orWhereExists(function () {
        this.select(1).from('groups_posts')
          .whereRaw('groups_posts.post_id = posts.id')
          .whereIn('groups_posts.group_id', myGroupIds)
      }))
    .whereNotIn('posts.user_id', BlockedUser.blockedFor(userId))
    .orderBy([{ column: 'posts.start_time', order: 'asc' }, { column: 'posts.id', order: 'asc' }])
    .limit(limit)
    .leftJoin('users', 'users.id', 'posts.user_id')
    .select('posts.id', 'posts.type', 'posts.name', 'posts.description', 'posts.agora_kind', 'posts.agora_for_all',
      'posts.start_time', 'posts.end_time', 'posts.timezone', 'posts.location', 'posts.updated_at', 'posts.created_at',
      'posts.user_id', 'users.name as user_name')

  if (rows.length === 0) return []

  // The circles each item is in: the person's own circles, and for an item
  // for all of 7BP also the circles that are not hidden.
  const memberOf = new Set((await myGroupIds.clone()).map(r => String(r.id)))
  const groupRows = await k('groups_posts')
    .join('groups', 'groups.id', 'groups_posts.group_id')
    .whereIn('groups_posts.post_id', rows.map(r => r.id))
    .where('groups.active', true)
    .orderBy('groups.name')
    .select('groups_posts.post_id', 'groups.id', 'groups.name', 'groups.slug', 'groups.visibility')
  const groupsOf = {}
  for (const g of groupRows) {
    (groupsOf[g.post_id] = groupsOf[g.post_id] || []).push(g)
  }

  return rows.map(row => {
    const kind = kindOf(row)
    const groups = (groupsOf[row.id] || [])
      .filter(g => memberOf.has(String(g.id)) || (row.agora_for_all && g.visibility !== Group.Visibility.HIDDEN))
      .map(g => ({ id: String(g.id), name: g.name, slug: g.slug }))
    return {
      id: String(row.id),
      kind,
      title: row.name || '',
      start: row.start_time,
      end: row.end_time || row.start_time,
      timezone: row.timezone || null,
      location: row.location || null,
      roomUrl: kind === MEETING && roomEnabled() ? meetingRoomUrl(row.id) : null,
      forAll: Boolean(row.agora_for_all),
      groups,
      creator: { id: String(row.user_id), name: row.user_name || '' },
      url: appUrl(`/post/${row.id}`),
      description: row.description || '',
      updatedAt: row.updated_at || row.created_at || null
    }
  })
}

/** For the page: the items between two dates it sends, as ISO text. */
export async function itemsForPage (userId, { from, to } = {}) {
  const start = new Date(from)
  const end = new Date(to)
  if (isNaN(start) || isNaN(end) || end <= start) throw new CalendarError(400, 'Those dates are not valid.')
  if ((end - start) / 86400000 > MAX_RANGE_DAYS) throw new CalendarError(400, 'Please ask for a shorter time.')
  const items = await itemsFor(userId, { from: start, to: end })
  return items.map(({ description, ...item }) => ({ ...item, summary: plainText(description, 200) }))
}

/** What the page needs to know about the person: may they mark things for all of 7BP. */
export async function aboutMe (userId) {
  const main = await mainGroup()
  return {
    canMarkForAll: await canMarkForAll(userId),
    mainGroup: main ? { id: String(main.id), name: main.name, slug: main.slug } : null
  }
}

/* ---------- The calendar link ---------- */

function newToken () {
  return crypto.randomBytes(32).toString('base64url')
}

/** A calendar link has exactly this shape: 43 letters, digits, - and _. */
export function looksLikeToken (value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''))
}

export function feedUrl (token) {
  return appUrl(`/noo/agora/calendar/${token}.ics`)
}

/** The person's calendar link, or null when they have none. */
export async function myFeed (userId) {
  const row = await knex()('agora_calendar_feeds').where({ user_id: userId }).first('token', 'created_at')
  return { url: row ? feedUrl(row.token) : null, createdAt: row ? row.created_at : null }
}

/** Makes a new calendar link. The old one, if any, stops working at once. */
export async function renewFeed (userId) {
  const token = newToken()
  await knex().raw(
    'insert into agora_calendar_feeds (user_id, token, created_at) values (?, ?, now()) on conflict (user_id) do update set token = excluded.token, created_at = excluded.created_at',
    [userId, token]
  )
  return myFeed(userId)
}

/** Switches the calendar link off. */
export async function revokeFeed (userId) {
  await knex()('agora_calendar_feeds').where({ user_id: userId }).del()
  return { url: null, createdAt: null }
}

/**
 * The person a calendar link belongs to, or null for a link that is wrong,
 * switched off, or belongs to someone who can no longer log in.
 */
export async function userForToken (token) {
  if (!looksLikeToken(token)) return null
  const row = await knex()('agora_calendar_feeds')
    .join('users', 'users.id', 'agora_calendar_feeds.user_id')
    .where('agora_calendar_feeds.token', token)
    .where('users.active', true)
    .first('users.id')
  return row ? String(row.id) : null
}

/* ---------- The calendar file ---------- */

function describe (item) {
  const lines = []
  lines.push(item.kind === MEETING ? 'Meeting in Agora' : 'Event in Agora')
  if (item.forAll) lines.push('For all of 7BP')
  if (item.groups.length) lines.push(`Circle: ${item.groups.map(g => g.name).join(', ')}`)
  if (item.roomUrl) lines.push(`Meeting room: ${item.roomUrl}`)
  if (item.kind === MEETING && item.location) lines.push(`Place: ${item.location}`)
  const text = plainText(item.description, 1500)
  if (text) lines.push('', text)
  lines.push('', `In Agora: ${item.url}`)
  return lines.join('\n')
}

/** The calendar file (.ics text) for a person: exactly what their calendar page shows. */
export async function feedFor (userId) {
  const now = Date.now()
  const items = await itemsFor(userId, {
    from: new Date(now - FEED_PAST_DAYS * 86400000),
    to: new Date(now + FEED_FUTURE_DAYS * 86400000)
  })
  const cal = ical({
    name: 'Agora (7BP)',
    description: 'Meetings and events from Agora, the online home of 7 Billion Presidents',
    prodId: { company: '7 Billion Presidents', product: 'Agora', language: 'EN' },
    scale: 'gregorian',
    // Asks calendar apps to fetch it again every hour. Google decides itself
    // and can take up to a day.
    ttl: 3600
  })
  for (const item of items) {
    cal.createEvent({
      id: `event-${item.id}-hylo.com`, // the same as Hylo's own calendar files and invitations (Post.iCalUid)
      start: item.start,
      end: item.end,
      summary: item.kind === MEETING ? `Meeting: ${item.title}` : item.title,
      description: describe(item),
      // A Meeting is held in its meeting room; an Event at its place.
      location: item.kind === MEETING ? (item.roomUrl || item.location || null) : (item.location || null),
      url: item.kind === MEETING && item.roomUrl ? item.roomUrl : item.url,
      categories: [{ name: item.kind === MEETING ? 'Meeting' : 'Event' }],
      lastModified: item.updatedAt || undefined
    })
  }
  return cal.toString()
}

/* ---------- Calendar invitations for all of 7BP ---------- */

/**
 * Sends every active Agora member (except the person who made it) an email
 * with the calendar file of a new Meeting or Event for all of 7BP. Emails go
 * out only when the server can send email (AGORA_EMAIL_TRANSPORT); on a Mac
 * they are written to the log. Returns how many were handed to the mailer.
 */
export async function inviteEveryone ({ postId, inviterId, sendEmail } = {}) {
  const post = await Post.find(postId)
  if (!post || post.get('type') !== 'event' || !post.get('agora_for_all')) return 0
  await post.load(['groups', 'user'])
  const group = post.relations.groups.first()
  const kind = kindOf(post)
  const inviter = inviterId ? await User.find(inviterId) : post.relations.user
  const inviterName = inviter ? inviter.get('name') : 'Agora'
  const cal = await post.createCalInvite({ userId: inviterId, eventInvitation: null, eventChanges: null, groupName: group })
  const file = { id: 'invite.ics', data: Buffer.from(cal.toString(), 'utf8').toString('base64') }

  const people = await knex()('users')
    .where('users.active', true)
    .whereNotNull('users.email')
    .whereNot('users.id', inviterId || 0)
    .whereExists(function () {
      this.select(1).from('group_memberships')
        .join('groups', 'groups.id', 'group_memberships.group_id')
        .whereRaw('group_memberships.user_id = users.id')
        .where('group_memberships.active', true)
        .where('groups.active', true)
    })
    .orderBy('users.id')
    .select('users.id', 'users.email', 'users.name')

  const send = sendEmail || ((email, data, files) => Email.sendSimpleEmail(email, 'agora_calendar_invite', data, { files, sender: { name: inviterName } }))
  const roomUrl = kind === MEETING && roomEnabled() ? meetingRoomUrl(post.id) : null
  let sent = 0
  for (const person of people) {
    const data = {
      kind: kind === EVENT ? 'event' : 'meeting',
      title: post.get('name'),
      inviter_name: inviterName,
      recipient_name: person.name,
      when: post.get('start_time') ? formatWhen(post) : null,
      location: post.get('location') || null,
      room_url: roomUrl,
      details: post.get('description') || '',
      url: appUrl(`/post/${post.id}`)
    }
    try {
      await send(person.email, data, [file])
      sent++
    } catch (err) {
      console.error(`Agora calendar: the invitation for post ${post.id} could not be sent to user ${person.id}:`, err && err.message)
    }
  }
  return sent
}

function formatWhen (post) {
  return DateTimeHelpers.formatDatePair({
    start: post.get('start_time'),
    end: post.get('end_time'),
    timezone: post.get('timezone'),
    locale: 'en'
  })
}

export default {
  itemsFor,
  itemsForPage,
  aboutMe,
  myFeed,
  renewFeed,
  revokeFeed,
  userForToken,
  looksLikeToken,
  feedUrl,
  feedFor,
  inviteEveryone,
  CalendarError
}
