/**
 * Agora: someone who joined a meeting, and whether they agreed to have their
 * voice turned into text for the minutes.
 */
module.exports = bookshelf.Model.extend({
  tableName: 'meeting_participants',
  requireFetch: false,
  hasTimestamps: false,

  user: function () {
    return this.belongsTo(User, 'user_id')
  },

  session: function () {
    return this.belongsTo(MeetingSession, 'session_id')
  }
}, {
  /**
   * Records that a person joined. Joining again only updates their choice.
   */
  upsert: async function ({ sessionId, userId, notesConsent }) {
    const existing = await MeetingParticipant.where({ session_id: sessionId, user_id: userId }).fetch()
    const now = new Date()
    if (existing) {
      // Joining again: back in the call (last_seen_at and left_at are how
      // Agora knows who is still here, see lib/agora/meetingChat.js)
      await existing.save({ notes_consent: notesConsent, last_seen_at: now, left_at: null }, { patch: true })
      return existing
    }
    return new MeetingParticipant({
      session_id: sessionId,
      user_id: userId,
      notes_consent: notesConsent,
      joined_at: now,
      last_seen_at: now
    }).save()
  }
})
