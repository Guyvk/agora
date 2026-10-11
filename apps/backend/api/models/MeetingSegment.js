/**
 * Agora: one stretch of speech by one person in a meeting.
 *
 * The browser sends the sound, the worker turns it into text, and the sound is
 * then removed. Only the text is kept.
 */
module.exports = bookshelf.Model.extend({
  tableName: 'meeting_segments',
  requireFetch: false,
  hasTimestamps: true,

  user: function () {
    return this.belongsTo(User, 'user_id')
  },

  session: function () {
    return this.belongsTo(MeetingSession, 'session_id')
  }
}, {
  Status: {
    PENDING: 'pending',
    DONE: 'done',
    EMPTY: 'empty',
    FAILED: 'failed'
  },

  /**
   * Worker job: turn one segment's sound into text, then delete the sound.
   * Throwing makes the queue try again later, up to three times.
   */
  transcribe: async function ({ segmentId }) {
    const segment = await MeetingSegment.where({ id: segmentId }).fetch()
    if (!segment || segment.get('status') !== MeetingSegment.Status.PENDING) return

    const audio = segment.get('audio')
    if (!audio) {
      await segment.save({ status: MeetingSegment.Status.EMPTY }, { patch: true })
      return
    }

    try {
      const text = await Transcription.transcribe({
        audio,
        mimeType: segment.get('mime_type') || 'audio/webm',
        durationMs: segment.get('duration_ms')
      })
      await segment.save({
        text,
        audio: null,
        error: null,
        status: text ? MeetingSegment.Status.DONE : MeetingSegment.Status.EMPTY
      }, { patch: true })
    } catch (err) {
      await segment.save({ error: String(err.message || err).slice(0, 500) }, { patch: true })
      throw err
    }
  }
})
