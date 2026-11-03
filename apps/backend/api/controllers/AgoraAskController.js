/**
 * Agora: the server part of a circle's Ask tab, see lib/agora/ask.js.
 *
 *   GET  /noo/agora/ask/api/:groupSlug/status     on or off, and the circle's name
 *   GET  /noo/agora/ask/api/:groupSlug/history    the person's own questions in this circle
 *   POST /noo/agora/ask/api/:groupSlug/ask        { question } -> the answer with its sources
 *   POST /noo/agora/ask/api/answers/:questionId/share   posts the answer in the circle
 *
 * Every action needs a login (config/policies.js) and checks membership of the
 * circle itself (lib/agora/askPermissions.js). Changes must come from the page:
 * it sends an X-Agora header, which another website cannot add.
 */
import Ask from '../../lib/agora/ask'

function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

function action (fn, { change = false } = {}) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store')
    if (change && !fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const userId = req.session && req.session.userId
    if (!userId) return res.status(401).send({ error: 'Please log in.' })
    try {
      return await fn(req, res, String(userId))
    } catch (err) {
      if (err instanceof Ask.AskError) return res.status(err.status).send({ error: err.message, code: err.code || null })
      throw err
    }
  }
}

module.exports = {
  status: action(async (req, res, userId) => {
    res.ok(await Ask.status(userId, req.param('groupSlug')))
  }),

  history: action(async (req, res, userId) => {
    res.ok({ questions: await Ask.history(userId, req.param('groupSlug')) })
  }),

  ask: action(async (req, res, userId) => {
    res.ok({ question: await Ask.ask(userId, req.param('groupSlug'), (req.body || {}).question) })
  }, { change: true }),

  share: action(async (req, res, userId) => {
    res.ok(await Ask.share(userId, req.param('questionId')))
  }, { change: true })
}
