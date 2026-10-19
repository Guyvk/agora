import {
  renderRoom, meetDomain, webUrl, setRoomHeaders, fromAgoraPage, receiveSegment
} from '../../lib/agora/meetingRoom'
import { canManageGuestLink, createLink, revokeLink, findLink, guestLabel, defaultExpiry } from '../../lib/agora/meetingGuests'
import {
  isHere, memberSeen, memberLeft, postMessage, listMessages, forPage, summary
} from '../../lib/agora/meetingChat'

/**
 * Agora meetings.
 *
 * Every event gets a meeting room at /noo/meeting/<event id>/room. People join
 * the call there, and while they speak their own browser sends short pieces of
 * their speech to be turned into text. When the meeting ends, the assistant
 * writes the minutes and posts them in the event's group.
 *
 * Settings (see .env.example):
 *   AGORA_MEET_DOMAIN   the Jitsi server that hosts the call, e.g. kmeet.infomaniak.com.
 *                       Calls always run here: the room never opens another
 *                       platform's link. Empty means no call, only the notes.
 */

async function loadEvent (req, res) {
  const postId = req.param('postId')
  if (!/^\d+$/.test(String(postId))) {
    res.status(400).send({ error: 'That is not a valid event.' })
    return null
  }
  const post = await Post.find(postId, { withRelated: ['groups'] })
  if (!post || post.get('type') !== Post.Type.EVENT) {
    res.status(404).send({ error: 'This event does not exist.' })
    return null
  }
  const allowed = await Post.isVisibleToUser(post.id, req.session.userId)
  if (!allowed) {
    res.status(403).send({ error: 'You do not have access to this event.' })
    return null
  }
  return post
}

async function statusPayload (post, session, userId) {
  if (!session) return { status: 'none', lines: [] }

  let minutesUrl = null
  if (session.get('minutes_post_id')) {
    const group = post.relations.groups.first()
    minutesUrl = Frontend.Route.post({ id: session.get('minutes_post_id') }, group)
  }

  const pending = await bookshelf.knex('meeting_segments')
    .where({ session_id: session.id, status: MeetingSegment.Status.PENDING })
    .count('id as count')
    .first()

  // Agora: pieces of speech the speech to text service refused or failed on,
  // so the room can say so instead of staying silently empty.
  const troubled = await bookshelf.knex('meeting_segments')
    .where({ session_id: session.id })
    .where(q => q.whereNotNull('error').orWhere('status', MeetingSegment.Status.FAILED))
    .count('id as count')
    .first()

  // Members who are in the call now: their room page said "still here" in the last minute and a half.
  const now = Date.now()
  const people = (await bookshelf.knex('meeting_participants')
    .join('users', 'users.id', 'meeting_participants.user_id')
    .where('meeting_participants.session_id', session.id)
    .orderBy('meeting_participants.joined_at', 'asc')
    .select('users.id', 'users.name', 'meeting_participants.notes_consent', 'meeting_participants.joined_at',
      'meeting_participants.last_seen_at', 'meeting_participants.left_at'))
    .filter(p => isHere(p, now))

  // Guests who are still here, each name once (a guest who reloads the page joins again).
  const guestRows = (await bookshelf.knex('meeting_guests')
    .where({ session_id: session.id })
    .whereNull('left_at')
    .orderBy('joined_at', 'asc')
    .select('name', 'notes_consent', 'joined_at', 'last_seen_at', 'left_at'))
    .filter(g => isHere(g, now))
  const guests = []
  for (const g of guestRows) {
    const existing = guests.find(x => x.name === g.name)
    if (existing) existing.notes = g.notes_consent
    else guests.push({ name: g.name, notes: g.notes_consent })
  }

  return {
    status: session.get('status'),
    sessionId: String(session.id),
    startedAt: session.get('started_at'),
    pending: Number(pending.count),
    failing: Number(troubled.count),
    minutesUrl,
    people: people.map(p => ({ id: String(p.id), name: p.name, notes: p.notes_consent, me: String(p.id) === String(userId) }))
      .concat(guests.map(g => ({ id: null, name: guestLabel(g.name), notes: g.notes, guest: true, me: false })))
  }
}

/**
 * The meeting `sessionId` of this event, for a member who took part in it.
 * The chat, the "still here" signal and the end screen are only for people
 * who were in that meeting. Answers the request and returns null otherwise.
 */
async function loadMySession (req, res, post) {
  const sessionId = String(req.param('sessionId') || req.query.sessionId || '')
  if (!/^\d{1,18}$/.test(sessionId)) {
    res.status(400).send({ error: 'Which meeting? Reload the page.' })
    return null
  }
  const session = await MeetingSession.where({ id: sessionId, post_id: post.id }).fetch()
  const participant = session && await MeetingParticipant.where({ session_id: session.id, user_id: req.session.userId }).fetch()
  if (!session || !participant) {
    res.status(403).send({ error: 'Only people in this meeting can see this.' })
    return null
  }
  return session
}

/** What the event page shows about the guest link to someone who may manage it. */
function guestLinkPayload (row) {
  if (!row || row.revoked_at) return null
  return {
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() <= Date.now(),
    createdAt: row.updated_at || row.created_at
  }
}

module.exports = {
  /**
   * The meeting room page itself.
   */
  room: async function (req, res) {
    if (!UserSession.isLoggedIn(req)) {
      return res.redirect(webUrl(`/login?returnToUrl=${encodeURIComponent(req.originalUrl)}`))
    }

    const post = await loadEvent(req, res)
    if (!post) return

    const user = await User.find(req.session.userId)
    const group = post.relations.groups.first()
    const domain = meetDomain()

    const boot = {
      eventId: String(post.id),
      title: post.get('name') || 'Meeting',
      groupName: group ? group.get('name') : '',
      eventUrl: Frontend.Route.post(post, group),
      api: `/noo/meeting/${post.id}`,
      meetDomain: domain,
      me: { id: String(user.id), name: user.get('name') },
      transcriptionReady: Transcription.isConfigured(),
      assistantReady: MeetingMinutes.isConfigured()
    }

    setRoomHeaders(res)
    res.type('html').send(renderRoom(boot))
  },

  /**
   * Called when someone enters the room. Starts the meeting if it is the first person.
   */
  join: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return

    const notesConsent = req.param('notes') !== false && req.param('notes') !== 'false'
    const session = await MeetingSession.openForPost({ post, userId: req.session.userId })
    await MeetingParticipant.upsert({ sessionId: session.id, userId: req.session.userId, notesConsent })

    res.ok({
      ...(await statusPayload(post, session, req.session.userId)),
      roomName: session.get('room_name'),
      notes: notesConsent
    })
  },

  /**
   * Receives one piece of speech. The sound is stored only until it has been
   * turned into text, which normally takes a few seconds.
   */
  segment: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return

    const userId = req.session.userId
    const session = await MeetingSession.findOpenForPost(post.id)
    if (!session || String(session.id) !== String(req.query.sessionId)) {
      return res.status(409).send({ error: 'This meeting has ended.' })
    }

    const participant = await MeetingParticipant.where({ session_id: session.id, user_id: userId }).fetch()
    if (!participant || !participant.get('notes_consent')) {
      return res.status(403).send({ error: 'Your voice is not part of the notes for this meeting.' })
    }

    return receiveSegment({ req, res, session, speaker: { user_id: userId } })
  },

  /**
   * What has been said so far, for the notes panel in the room.
   */
  transcript: async function (req, res) {
    const post = await loadEvent(req, res)
    if (!post) return

    const requested = req.query.sessionId
    const session = requested
      ? await MeetingSession.where({ id: requested, post_id: post.id }).fetch()
      : await MeetingSession.findLatestForPost(post.id)

    const payload = await statusPayload(post, session, req.session.userId)
    if (session) {
      const afterId = /^\d+$/.test(String(req.query.afterId || '')) ? req.query.afterId : null
      payload.lines = await MeetingSession.lines(session.id, { afterId })
    }
    res.ok(payload)
  },

  /**
   * Agora: the room page of a member asks this every few seconds while they
   * are in the call. It counts as "still here" (so the meeting does not end
   * by itself) and answers with who is here and the new chat messages.
   * No transcript text: the notes are not shown during the meeting.
   */
  live: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return
    const session = await loadMySession(req, res, post)
    if (!session) return

    if (session.isOpen()) await memberSeen(session.id, req.session.userId)
    const payload = await statusPayload(post, session, req.session.userId)
    delete payload.lines
    payload.chat = forPage(await listMessages(session.id, { afterId: req.param('chatAfter') }), { userId: req.session.userId })
    res.set('Cache-Control', 'no-store')
    res.ok(payload)
  },

  /**
   * Agora: one chat message, from a member who is in the meeting.
   */
  chat: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return
    const session = await loadMySession(req, res, post)
    if (!session) return
    if (!session.isOpen()) return res.status(409).send({ error: 'This meeting has ended.' })

    const { message, status, error } = await postMessage({ sessionId: session.id, userId: req.session.userId, text: req.param('text') })
    if (error) return res.status(status).send({ error })
    await memberSeen(session.id, req.session.userId)
    res.ok({ message: forPage([message], { userId: req.session.userId })[0] })
  },

  /**
   * Agora: a member leaves the call. The meeting goes on for the others.
   */
  leave: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return
    const session = await loadMySession(req, res, post)
    if (!session) return
    if (session.isOpen()) await memberLeft(session.id, req.session.userId)
    res.ok({ status: 'left' })
  },

  /**
   * Agora: the overview on the end screen, for a member who was in the
   * meeting: title, date, how long, who took part, whether notes were taken,
   * and the minutes once they are posted.
   */
  summary: async function (req, res) {
    const post = await loadEvent(req, res)
    if (!post) return
    const session = await loadMySession(req, res, post)
    if (!session) return
    const payload = await summary(session, post)
    const group = post.relations.groups.first()
    payload.minutesUrl = session.get('minutes_post_id')
      ? Frontend.Route.post({ id: session.get('minutes_post_id') }, group)
      : null
    res.set('Cache-Control', 'no-store')
    res.ok(payload)
  },

  /**
   * Ends the meeting for everyone. The minutes are then written in the background.
   */
  end: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return

    const session = await MeetingSession.findOpenForPost(post.id)
    if (!session) return res.ok({ status: 'none' })

    const participant = await MeetingParticipant.where({ session_id: session.id, user_id: req.session.userId }).fetch()
    if (!participant) return res.status(403).send({ error: 'Only people in the meeting can end it.' })

    await MeetingSession.end({ sessionId: session.id, userId: req.session.userId })
    res.ok({ status: MeetingSession.Status.CLOSING })
  },

  /**
   * The guest link of this event, for the event page. Only the person who made
   * the event and the circle's stewards see it; everyone else gets canManage: false.
   * The link itself is never shown again after it was made: Agora keeps only its hash.
   */
  guestLink: async function (req, res) {
    const post = await loadEvent(req, res)
    if (!post) return
    res.set('Cache-Control', 'no-store')
    if (!(await canManageGuestLink(req.session.userId, post))) return res.ok({ canManage: false })
    res.ok({
      canManage: true,
      available: !!meetDomain(),
      link: guestLinkPayload(await findLink(post.id))
    })
  },

  /**
   * Makes a new guest link, replacing the old one (which stops working).
   */
  createGuestLink: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return
    if (!(await canManageGuestLink(req.session.userId, post))) {
      return res.status(403).send({ error: 'Only the person who made this event and the stewards of its circle can invite guests.' })
    }
    if (!meetDomain()) {
      return res.status(503).send({ error: 'Guest links need the call inside Agora, which is not switched on here (AGORA_MEET_DOMAIN).' })
    }
    if (defaultExpiry(post).getTime() <= Date.now()) {
      return res.status(409).send({ error: 'This event ended more than two hours ago, so a guest link would not work any more.' })
    }
    const { secret } = await createLink({ post, userId: req.session.userId })
    res.set('Cache-Control', 'no-store')
    res.ok({
      url: webUrl(`/noo/meeting/${post.id}/guest/${secret}`),
      link: guestLinkPayload(await findLink(post.id))
    })
  },

  /**
   * Closes the guest link. Guests in the call are sent out within seconds.
   */
  revokeGuestLink: async function (req, res) {
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const post = await loadEvent(req, res)
    if (!post) return
    if (!(await canManageGuestLink(req.session.userId, post))) {
      return res.status(403).send({ error: 'Only the person who made this event and the stewards of its circle can invite guests.' })
    }
    await revokeLink(post.id)
    res.ok({ link: null })
  }
}
