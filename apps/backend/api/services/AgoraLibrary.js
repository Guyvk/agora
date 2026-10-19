/**
 * Agora: the circle library, as a service the worker and the cron job can call
 * by name (Queue.classMethod('AgoraLibrary', 'extractPost', { postId })).
 * The code lives in lib/agora/library.js.
 */
import Library from '../../lib/agora/library'

module.exports = {
  /** Worker job: reads the text of the files of one library item. */
  extractPost: function (args) {
    return Library.extractPost(args)
  },

  /** Daily: removes files that were sent but never added to an item. */
  cleanUnfinishedUploads: function (args) {
    return Library.cleanUnfinishedUploads(args)
  },

  /** Files the notes of an ended meeting in the library. Called by MeetingSession.finalize. */
  fileMeeting: function (args) {
    return Library.fileMeeting(args)
  }
}
