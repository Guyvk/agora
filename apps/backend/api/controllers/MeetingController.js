import fs from 'fs'
import path from 'path'
import { isMeetingRoomUrl } from '../../lib/agora/meetingLink'

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
 *                       Leave empty to use the event's own video link in a second window.
 */

const MAX_SEGMENT_BYTES = 4 * 1024 * 1024
const MAX_SEGMENT_MS = 120000
const MAX_SEGMENTS_PER_PERSON = 3000

const ROOM_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'agora', 'meeting-room.html')
let roomTemplate = null

function loadRoomTemplate () {
  if (!roomTemplate || process.env.NODE_ENV === 'development') {
    roomTemplate = fs.readFileSync(ROOM_TEMPLATE_PATH, 'utf8')
  }
  return roomTemplate
}

function meetDomain () {
  return (process.env.AGORA_MEET_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function webUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

function readBody (req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => tooLarge ? reject(new Error('too large')) : resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Every call that changes something must carry this header. A form on another
 * website cannot send it, so the calls cannot be triggered from outside Agora.
 */
function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

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

  const people = await bookshelf.knex('meeting_participants')
    .join('users', 'users.id', 'meeting_participants.user_id')
    .where('meeting_participants.session_id', session.id)
    .orderBy('meeting_participants.joined_at', 'asc')
    .select('users.id', 'users.name', 'meeting_participants.notes_consent')

  return {
    status: session.get('status'),
    sessionId: String(session.id),
    startedAt: session.get('started_at'),
    pending: Number(pending.count),
    minutesUrl,
    people: people.map(p => ({ id: String(p.id), name: p.name, notes: p.notes_consent, me: String(p.id) === String(userId) }))
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
      // The event's own video call link, unless that link is this room itself
      meetingLink: isMeetingRoomUrl(post.get('meeting_link')) ? '' : (post.get('meeting_link') || ''),
      api: `/noo/meeting/${post.id}`,
      meetDomain: domain,
      me: { id: String(user.id), name: user.get('name') },
      transcriptionReady: Transcription.isConfigured(),
      assistantReady: MeetingMinutes.isConfigured()
    }

    // A function is used so that "$" in a title is not read as a replace pattern.
    const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c')
    const html = loadRoomTemplate().replace('"__AGORA_BOOT__"', () => bootJson)

    // The call runs inside a frame from another site, which needs to be told
    // that it may use the camera and the microphone.
    const frameOrigin = domain ? ` "https://${domain}"` : ''
    res.set('Permissions-Policy', `camera=(self${frameOrigin}), microphone=(self${frameOrigin}), display-capture=(self${frameOrigin})`)
    res.set('Cache-Control', 'no-store')
    res.type('html').send(html)
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

    const spokenAt = new Date(Number(req.query.spokenAt))
    const durationMs = Math.round(Number(req.query.durationMs))
    const earliest = new Date(session.get('started_at')).getTime() - 60000
    if (isNaN(spokenAt) || spokenAt.getTime() < earliest || spokenAt.getTime() > Date.now() + 60000 ||
      !(durationMs > 0) || durationMs > MAX_SEGMENT_MS) {
      return res.status(400).send({ error: 'The timing of this piece of speech is not valid.' })
    }

    const count = await bookshelf.knex('meeting_segments')
      .where({ session_id: session.id, user_id: userId })
      .count('id as count')
      .first()
    if (Number(count.count) >= MAX_SEGMENTS_PER_PERSON) {
      return res.status(429).send({ error: 'Too much speech was sent for one meeting.' })
    }

    let audio
    try {
      audio = await readBody(req, MAX_SEGMENT_BYTES)
    } catch (err) {
      return res.status(413).send({ error: 'This piece of speech is too large.' })
    }
    if (audio.length < 200) return res.status(400).send({ error: 'No sound was received.' })

    const mimeType = String(req.headers['content-type'] || 'audio/webm').slice(0, 100)
    if (!mimeType.startsWith('audio/')) return res.status(415).send({ error: 'Only sound is accepted here.' })

    const ready = Transcription.isConfigured()
    const segment = await new MeetingSegment({
      session_id: session.id,
      user_id: userId,
      spoken_at: spokenAt,
      duration_ms: durationMs,
      mime_type: mimeType,
      audio: ready ? audio : null,
      status: ready ? MeetingSegment.Status.PENDING : MeetingSegment.Status.FAILED,
      error: ready ? null : 'Transcription is not set up.'
    }).save()

    await MeetingSession.touch(session.id)
    if (ready) await Queue.classMethod('MeetingSegment', 'transcribe', { segmentId: segment.id }, 0)

    res.ok({ id: String(segment.id), transcribing: ready })
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
   * Ends the meeting. The minutes are then written in the background.
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
  }
}
