import crypto from 'crypto'
import createPost from './post/createPost'

/**
 * Agora: one meeting held on an event.
 *
 * A session opens when the first person joins the meeting room of an event.
 * While it is open, each person's browser sends short pieces of their own
 * speech (see MeetingSegment). When the meeting ends, the assistant writes
 * the minutes and posts them in the same group as the event.
 */

const STALE_AFTER_MINUTES = 45
const WAIT_FOR_TRANSCRIPTION_MINUTES = 10

module.exports = bookshelf.Model.extend({
  tableName: 'meeting_sessions',
  requireFetch: false,
  hasTimestamps: true,

  post: function () {
    return this.belongsTo(Post, 'post_id')
  },

  minutesPost: function () {
    return this.belongsTo(Post, 'minutes_post_id')
  },

  participants: function () {
    return this.hasMany(MeetingParticipant, 'session_id')
  },

  segments: function () {
    return this.hasMany(MeetingSegment, 'session_id')
  },

  isOpen: function () {
    return this.get('status') === MeetingSession.Status.OPEN
  }
}, {
  Status: {
    OPEN: 'open',
    CLOSING: 'closing',
    CLOSED: 'closed'
  },

  /** The meeting that is going on now for this event, if any. */
  findOpenForPost: function (postId) {
    return MeetingSession.where({ post_id: postId, status: MeetingSession.Status.OPEN }).fetch()
  },

  /** The most recent meeting for this event, open or not. */
  findLatestForPost: function (postId) {
    return MeetingSession.query(q => {
      q.where({ post_id: postId })
      q.orderBy('id', 'desc')
      q.limit(1)
    }).fetch()
  },

  /**
   * Returns the open meeting for this event, starting one if needed.
   * The room name carries a random part, so it cannot be guessed from the event.
   */
  openForPost: async function ({ post, userId }) {
    const existing = await MeetingSession.findOpenForPost(post.id)
    if (existing) return existing

    const now = new Date()
    return new MeetingSession({
      post_id: post.id,
      room_name: `agora-${post.id}-${crypto.randomBytes(6).toString('hex')}`,
      status: MeetingSession.Status.OPEN,
      started_by_id: userId,
      started_at: now,
      last_activity_at: now
    }).save()
  },

  touch: function (sessionId) {
    return bookshelf.knex('meeting_sessions').where({ id: sessionId }).update({ last_activity_at: new Date() })
  },

  /**
   * Ends a meeting and asks the worker to write the minutes.
   */
  end: async function ({ sessionId, userId = null }) {
    const session = await MeetingSession.where({ id: sessionId }).fetch()
    if (!session || !session.isOpen()) return session

    await session.save({
      status: MeetingSession.Status.CLOSING,
      ended_by_id: userId,
      ended_at: new Date()
    }, { patch: true })

    await Queue.classMethod('MeetingSession', 'finalize', { sessionId: session.id }, 5000)
    return session
  },

  /**
   * Cron job: a meeting nobody ended by hand is ended once it has been quiet
   * for a while, so the minutes still get written.
   */
  closeStale: async function () {
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60000)
    const stale = await MeetingSession.query(q => {
      q.where({ status: MeetingSession.Status.OPEN })
      q.where('last_activity_at', '<', cutoff)
    }).fetchAll()

    for (const session of stale.models) {
      await MeetingSession.end({ sessionId: session.id })
    }
    return stale.length
  },

  /**
   * All transcribed lines of a meeting, oldest first.
   * @returns {Promise<Array<{id, userId, name, text, spokenAt}>>}
   */
  lines: async function (sessionId, { afterId } = {}) {
    const rows = await bookshelf.knex('meeting_segments')
      .join('users', 'users.id', 'meeting_segments.user_id')
      .where('meeting_segments.session_id', sessionId)
      .where('meeting_segments.status', MeetingSegment.Status.DONE)
      .modify(q => { if (afterId) q.where('meeting_segments.id', '>', afterId) })
      .orderBy('meeting_segments.spoken_at', 'asc')
      .orderBy('meeting_segments.id', 'asc')
      .select(
        'meeting_segments.id',
        'meeting_segments.user_id',
        'meeting_segments.text',
        'meeting_segments.spoken_at',
        'users.name'
      )

    return rows.map(r => ({ id: String(r.id), userId: String(r.user_id), name: r.name, text: r.text, spokenAt: r.spoken_at }))
  },

  /**
   * The account that posts the minutes. It is created the first time it is
   * needed and is clearly labelled as an AI.
   */
  assistantUser: async function () {
    const email = (process.env.AGORA_ASSISTANT_EMAIL || 'assistant@agora.invalid').toLowerCase()
    const existing = await User.where({ email }).fetch()
    if (existing) return existing

    const user = await User.create({
      email,
      name: process.env.AGORA_ASSISTANT_NAME || 'Agora Assistant',
      email_validated: true,
      tagline: 'I am an AI. I write the minutes and the weekly update.',
      bio: 'I am the Agora assistant, an AI. I turn meeting transcripts into minutes and summarise what happened each week. I can be wrong, so please correct me in the comments.'
    })
    await user.save({ settings: { ...(user.get('settings') || {}), signup_in_progress: false } }, { patch: true })
    return user
  },

  /**
   * Worker job: write the minutes of a meeting that has ended.
   */
  finalize: async function ({ sessionId }) {
    const session = await MeetingSession.where({ id: sessionId }).fetch({ withRelated: ['post', 'post.groups'] })
    if (!session || session.get('status') !== MeetingSession.Status.CLOSING) return

    // Give the last pieces of speech time to be turned into text.
    const pending = await bookshelf.knex('meeting_segments')
      .where({ session_id: sessionId, status: MeetingSegment.Status.PENDING })
      .count('id as count')
      .first()
    const waitedMs = Date.now() - new Date(session.get('ended_at')).getTime()

    if (Number(pending.count) > 0 && waitedMs < WAIT_FOR_TRANSCRIPTION_MINUTES * 60000) {
      await Queue.classMethod('MeetingSession', 'finalize', { sessionId }, 20000)
      return
    }

    // Whatever could not be transcribed by now is given up on. The sound is
    // removed either way: nothing is kept but text.
    await bookshelf.knex('meeting_segments')
      .where({ session_id: sessionId, status: MeetingSegment.Status.PENDING })
      .update({ status: MeetingSegment.Status.FAILED })
    await bookshelf.knex('meeting_segments')
      .where({ session_id: sessionId })
      .whereNotNull('audio')
      .update({ audio: null })

    const lines = await MeetingSession.lines(sessionId)

    if (lines.length === 0) {
      await session.save({ status: MeetingSession.Status.CLOSED }, { patch: true })
      return
    }

    const event = session.relations.post
    const groups = event.relations.groups.models
    const startedAt = session.get('started_at')

    const participantRows = await bookshelf.knex('meeting_participants')
      .join('users', 'users.id', 'meeting_participants.user_id')
      .where('meeting_participants.session_id', sessionId)
      .orderBy('meeting_participants.joined_at', 'asc')
      .select('users.name')
    const attendees = participantRows.map(r => r.name)

    const title = event.get('name') || 'Meeting'
    const date = new Date(startedAt).toISOString().slice(0, 10)

    let minutes = null
    let error = null
    if (MeetingMinutes.isConfigured()) {
      try {
        minutes = await MeetingMinutes.summarise({ title, date, attendees, lines, startedAt })
      } catch (err) {
        error = err
        sails.log.error(`MeetingSession.finalize: could not write minutes for session ${sessionId}: ${err.message}`)
      }
    }

    const description = MeetingMinutes.renderHtml({ minutes, attendees, lines, startedAt, error })

    const assistant = await MeetingSession.assistantUser()
    const now = new Date()
    for (const group of groups) {
      await group.addMembers([assistant.id], {
        settings: {
          showJoinForm: false,
          agreementsAcceptedAt: now,
          joinQuestionsAnsweredAt: now,
          postNotifications: 'none',
          digestFrequency: 'daily',
          sendEmail: false,
          sendPushNotifications: false
        }
      })
    }

    const minutesPost = await createPost(assistant.id, {
      name: `Minutes: ${title} (${date})`,
      description,
      type: Post.Type.DISCUSSION,
      group_ids: groups.map(g => g.id),
      topicNames: ['minutes'],
      skip_link_preview: true
    })

    await session.save({
      status: MeetingSession.Status.CLOSED,
      minutes_post_id: minutesPost.id
    }, { patch: true })

    return minutesPost
  }
})
