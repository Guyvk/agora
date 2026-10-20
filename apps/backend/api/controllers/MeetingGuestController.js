import {
  renderRoom, meetDomain, setRoomHeaders, fromAgoraPage, receiveSegment
} from '../../lib/agora/meetingRoom'
import {
  rateLimiter, LIMITS, FAILED_LIMIT, FAILED_WINDOW_MS, MAX_GUESTS_PER_MEETING, NAME_MAX,
  checkLink, cleanName, guestLabel, addGuest, countGuests, findGuest
} from '../../lib/agora/meetingGuests'
import { isMeeting } from '../../lib/agora/eventKinds'

/**
 * Agora: the meeting room for guests, people without an Agora account.
 *
 *   GET  /noo/meeting/<event id>/guest/<secret>          the guest's room page
 *   POST /noo/meeting/<event id>/guest/<secret>/join     name and consent, then the call
 *   POST /noo/meeting/<event id>/guest/<secret>/segment  one piece of the guest's own speech
 *   GET  /noo/meeting/<event id>/guest/<secret>/status   only: is the meeting still going?
 *   POST /noo/meeting/<event id>/guest/<secret>/end      the guest leaves (the meeting goes on)
 *
 * None of these needs an Agora login. Each one checks the link's secret,
 * and every call after joining also checks the guest's own secret (headers
 * X-Agora-Guest-Id and X-Agora-Guest-Key). Calls are counted per address.
 * There is no way for a guest to read the notes or end the meeting.
 * See lib/agora/meetingGuests.js and README-AGORA.md, "Guests in a meeting".
 */

const REASONS = {
  invalid: 'This guest link does not work. Ask the person who invited you for a new one.',
  revoked: 'This guest link was closed by the organisers. Ask them for a new one.',
  expired: 'This guest link has expired. Ask the person who invited you for a new one.'
}

function clientAddress (req) {
  return String(req.ip || (req.connection && req.connection.remoteAddress) || 'unknown')
}

/** Counts this call. Answers 429 and returns false when there were too many. */
function withinLimits (req, res, kind, who) {
  const address = clientAddress(req)
  if (rateLimiter.over(`guest-failed:${address}`, FAILED_LIMIT)) {
    res.status(429).send({ error: 'Too many tries with links that do not work. Wait a few minutes.' })
    return false
  }
  if (!rateLimiter.allow(`guest-${kind}:${who || address}`, LIMITS[kind], 60000)) {
    res.status(429).send({ error: 'Too many requests. Wait a minute and try again.' })
    return false
  }
  return true
}

function countFailure (req) {
  rateLimiter.allow(`guest-failed:${clientAddress(req)}`, FAILED_LIMIT, FAILED_WINDOW_MS)
}

/**
 * Finds the event and checks the link. Answers the request and returns null
 * when either is wrong.
 */
async function loadLink (req, res) {
  const postId = String(req.param('postId') || '')
  const secret = req.param('token')
  if (!/^\d{1,18}$/.test(postId)) {
    countFailure(req)
    res.status(404).send({ error: REASONS.invalid })
    return null
  }
  const { link, reason } = await checkLink(postId, secret)
  if (!link) {
    countFailure(req)
    res.status(reason === 'invalid' ? 404 : 410).send({ error: REASONS[reason] })
    return null
  }
  const post = await Post.find(postId, { withRelated: ['groups'] })
  if (!post || post.get('type') !== Post.Type.EVENT || !isMeeting(post) || !post.get('active')) { // only Meetings have a meeting room
    res.status(404).send({ error: REASONS.invalid })
    return null
  }
  return { link, post }
}

/**
 * For calls made after joining: the link, and the guest behind the guest's own secret.
 */
async function loadGuest (req, res) {
  const found = await loadLink(req, res)
  if (!found) return null
  const guest = await findGuest({
    guestId: req.headers['x-agora-guest-id'],
    key: req.headers['x-agora-guest-key'],
    linkId: found.link.id
  })
  if (!guest) {
    countFailure(req)
    res.status(403).send({ error: 'Join the meeting again from the guest link.' })
    return null
  }
  const session = await MeetingSession.where({ id: guest.session_id, post_id: found.post.id }).fetch()
  if (!session) {
    res.status(403).send({ error: 'Join the meeting again from the guest link.' })
    return null
  }
  return { ...found, guest, session }
}

function sendLinkProblem (res, status, message) {
  const safe = String(message).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  res.set('Cache-Control', 'no-store')
  res.status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Agora meeting</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;color:#1d1a22;background:#f5f3f6}@media (prefers-color-scheme:dark){body{color:#efecf3;background:#121016}}</style></head><body><h1>Agora meeting</h1><p>${safe}</p></body></html>`)
}

module.exports = {
  /**
   * The guest's room page: the same page members use, in guest mode.
   */
  page: async function (req, res) {
    // The secret is in the address: never send it on to other sites, never keep the page.
    res.set('Referrer-Policy', 'no-referrer')
    res.set('X-Robots-Tag', 'noindex, nofollow')
    if (!withinLimits(req, res, 'page')) return

    const postId = String(req.param('postId') || '')
    const secret = req.param('token')
    const { link, reason } = /^\d{1,18}$/.test(postId) ? await checkLink(postId, secret) : { reason: 'invalid' }
    if (!link) {
      countFailure(req)
      return sendLinkProblem(res, reason === 'invalid' ? 404 : 410, REASONS[reason])
    }
    const post = await Post.find(postId, { withRelated: ['groups'] })
    if (!post || post.get('type') !== Post.Type.EVENT || !isMeeting(post) || !post.get('active')) { // only Meetings have a meeting room
      return sendLinkProblem(res, 404, REASONS.invalid)
    }

    const group = post.relations.groups.first()
    const boot = {
      guest: true,
      eventId: String(post.id),
      title: post.get('name') || 'Meeting',
      groupName: group ? group.get('name') : '',
      eventUrl: null,
      api: `/noo/meeting/${post.id}/guest/${secret}`,
      meetDomain: meetDomain(),
      me: null,
      nameMax: NAME_MAX,
      expiresAt: link.expires_at,
      transcriptionReady: Transcription.isConfigured(),
      assistantReady: MeetingMinutes.isConfigured()
    }

    setRoomHeaders(res)
    res.type('html').send(renderRoom(boot))
  },

  /**
   * The guest gives a name and a choice about the notes, and joins the meeting
   * members have opened. Guests cannot start a meeting on their own.
   */
  join: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    if (!withinLimits(req, res, 'join')) return
    const found = await loadLink(req, res)
    if (!found) return
    if (!withinLimits(req, res, 'joinPerLink', `link-${found.link.id}`)) return

    const name = cleanName(req.param('name'))
    if (!name) {
      return res.status(400).send({ error: `Please give your name: at most ${NAME_MAX} letters, digits and spaces.` })
    }
    // Guests are only in the notes when they said yes, never by default.
    const notesConsent = req.param('notes') === true || req.param('notes') === 'true'

    const session = await MeetingSession.findOpenForPost(found.post.id)
    if (!session) {
      return res.status(409).send({ status: 'waiting', error: 'The meeting has not started yet. This page tries again by itself.' })
    }
    if (await countGuests(session.id) >= MAX_GUESTS_PER_MEETING) {
      return res.status(429).send({ error: 'This meeting has as many guests as it can take.' })
    }

    const { guest, key } = await addGuest({ sessionId: session.id, linkId: found.link.id, name, notesConsent })
    await MeetingSession.touch(session.id)

    res.ok({
      status: session.get('status'),
      sessionId: String(session.id),
      startedAt: session.get('started_at'),
      roomName: session.get('room_name'),
      notes: notesConsent,
      guestId: String(guest.id),
      guestKey: key,
      displayName: guestLabel(name)
    })
  },

  /**
   * One piece of the guest's own speech, only when they agreed to be in the notes.
   */
  segment: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    if (!withinLimits(req, res, 'segment', `guest-${req.headers['x-agora-guest-id']}`)) return
    const found = await loadGuest(req, res)
    if (!found) return
    const { guest, session } = found

    if (!session.isOpen() || String(session.id) !== String(req.query.sessionId)) {
      return res.status(409).send({ error: 'This meeting has ended.' })
    }
    if (!guest.notes_consent || guest.left_at) {
      return res.status(403).send({ error: 'Your voice is not part of the notes for this meeting.' })
    }
    return receiveSegment({ req, res, session, speaker: { guest_id: guest.id } })
  },

  /**
   * Only whether the meeting is still going. Guests never get the notes, the
   * names of others or the minutes.
   */
  status: async function (req, res) {
    if (!withinLimits(req, res, 'status', `guest-${req.headers['x-agora-guest-id']}`)) return
    const found = await loadGuest(req, res)
    if (!found) return
    res.set('Cache-Control', 'no-store')
    res.ok({ status: found.session.get('status') })
  },

  /**
   * The guest leaves. This never ends the meeting for anyone else.
   */
  end: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    if (!withinLimits(req, res, 'leave')) return
    const found = await loadGuest(req, res)
    if (!found) return
    await bookshelf.knex('meeting_guests').where({ id: found.guest.id }).whereNull('left_at').update({ left_at: new Date() })
    res.ok({ status: 'left' })
  }
}
