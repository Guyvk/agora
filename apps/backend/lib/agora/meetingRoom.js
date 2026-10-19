import fs from 'fs'
import path from 'path'

/**
 * Agora: helpers shared by the meeting room of members
 * (api/controllers/MeetingController.js) and of guests
 * (api/controllers/MeetingGuestController.js).
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

/** The room page with the details of this event filled in. */
function renderRoom (boot) {
  // A function is used so that "$" in a title is not read as a replace pattern.
  const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c')
  return loadRoomTemplate().replace('"__AGORA_BOOT__"', () => bootJson)
}

function meetDomain () {
  return (process.env.AGORA_MEET_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function webUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

/**
 * The call runs inside a frame from another site, which needs to be told
 * that it may use the camera and the microphone.
 */
function setRoomHeaders (res) {
  const domain = meetDomain()
  const frameOrigin = domain ? ` "https://${domain}"` : ''
  res.set('Permissions-Policy', `camera=(self${frameOrigin}), microphone=(self${frameOrigin}), display-capture=(self${frameOrigin})`)
  res.set('Cache-Control', 'no-store')
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

/**
 * Checks and stores one piece of speech, by a member ({ user_id }) or by a
 * guest ({ guest_id }). The caller has already checked that this person is in
 * the open meeting `session` and agreed to be in the notes. Answers the request.
 */
async function receiveSegment ({ req, res, session, speaker }) {
  // Without speech to text there is nothing to do with sound, so none is accepted or kept.
  if (!Transcription.isConfigured()) {
    return res.status(503).send({ error: 'Speech to text is not connected, so nothing is recorded.' })
  }

  const durationMs = Math.round(Number(req.query.durationMs))
  if (!(durationMs > 0) || durationMs > MAX_SEGMENT_MS) {
    return res.status(400).send({ error: 'The timing of this piece of speech is not valid.' })
  }
  // The time comes from the speaker's own computer, whose clock can be off.
  // Rather than lose the speech, a time that cannot be right is replaced by
  // the moment it arrived here.
  let spokenAt = new Date(Number(req.query.spokenAt))
  const earliest = new Date(session.get('started_at')).getTime() - 60000
  if (isNaN(spokenAt) || spokenAt.getTime() < earliest || spokenAt.getTime() > Date.now() + 60000) {
    spokenAt = new Date(Date.now() - durationMs)
  }

  const count = await bookshelf.knex('meeting_segments')
    .where({ session_id: session.id, ...speaker })
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

  const segment = await new MeetingSegment({
    session_id: session.id,
    ...speaker,
    spoken_at: spokenAt,
    duration_ms: durationMs,
    mime_type: mimeType,
    audio,
    status: MeetingSegment.Status.PENDING
  }).save()

  await MeetingSession.touch(session.id)
  await Queue.classMethod('MeetingSegment', 'transcribe', { segmentId: segment.id }, 0)

  res.ok({ id: String(segment.id), transcribing: true })
}

module.exports = {
  renderRoom,
  meetDomain,
  webUrl,
  setRoomHeaders,
  readBody,
  fromAgoraPage,
  receiveSegment
}
