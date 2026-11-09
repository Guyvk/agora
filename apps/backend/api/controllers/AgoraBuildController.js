/**
 * Agora: the server part of the Build page, see lib/agora/buildBoard.js.
 *
 *   /noo/agora/build/api/...   what the Build page reads and changes, as JSON
 *
 * Logged out: 401. Not a member of the Build circle (AGORA_BUILD_CIRCLE): 403.
 * Moving a card must come from the page itself (X-Agora header).
 */
import Build from '../../lib/agora/buildBoard'

function action (fn, { change = false } = {}) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store')
    const userId = req.session && req.session.userId
    if (!userId) return res.status(401).send({ error: 'Please log in.' })
    if (change && req.headers['x-agora'] !== '1') return res.status(400).send({ error: 'Bad request.' })
    try {
      return await fn(req, res, userId)
    } catch (err) {
      if (err instanceof Build.BuildError) return res.status(err.status).send({ error: err.message })
      return res.serverError(err)
    }
  }
}

module.exports = {
  access: action(async (req, res, userId) => res.ok(await Build.access(userId))),
  board: action(async (req, res, userId) => res.ok(await Build.board(userId, { force: (req.query || {}).refresh === '1' }))),
  move: action(async (req, res, userId) => res.ok(await Build.move(userId, req.body || {})), { change: true })
}
