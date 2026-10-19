/**
 * Agora: the background jobs of the Ask tab, run by the worker through
 * Queue.classMethod('AgoraAsk', ...). The work itself is in lib/agora/askIndex.js
 * and lib/agora/privateThemes.js.
 *
 * Every job does nothing when Ask is off (AGORA_ASK_ENABLED), so a server
 * without Ask spends nothing on it.
 */
import Ask from '../../lib/agora/ask'
import AskIndex from '../../lib/agora/askIndex'
import PrivateThemes from '../../lib/agora/privateThemes'

const off = () => !Ask.isEnabled()

module.exports = {
  /** Queues indexing a post (and its comments) again, a few seconds from now. Never fails the caller. */
  queuePost: function (postId, delay = 5000) {
    if (off() || !postId) return Promise.resolve()
    return Queue.classMethod('AgoraAsk', 'indexPost', { postId }, delay)
      .catch(err => sails.log.error(`Agora Ask: could not queue indexing post ${postId}: ${err.message}`))
  },

  indexPost: async function ({ postId }) {
    if (off()) return 0
    const count = await AskIndex.indexPost(postId)
    await AskIndex.embedMissing({ limit: 64 })
    return count
  },

  removePost: async function ({ postId }) {
    return AskIndex.removePost(postId)
  },

  /** Every 10 minutes (cron.js): whatever the jobs above missed. */
  catchUp: async function () {
    if (off()) return null
    return AskIndex.catchUp()
  },

  /** Once a day (cron.js), and on demand: the anonymised themes of private messages. */
  refreshPrivateThemes: async function () {
    if (off()) return null
    return PrivateThemes.refreshThemes()
  }
}
