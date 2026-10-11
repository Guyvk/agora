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
    if (existing) {
      if (existing.get('notes_consent') !== notesConsent) {
        await existing.save({ notes_consent: notesConsent }, { patch: true })
      }
      return existing
    }
    return new MeetingParticipant({
      session_id: sessionId,
      user_id: userId,
      notes_consent: notesConsent,
      joined_at: new Date()
    }).save()
  }
})
