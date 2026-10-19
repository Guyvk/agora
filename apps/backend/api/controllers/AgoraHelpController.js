/**
 * Agora: the server part of Help and the Help desk, see lib/agora/help.js.
 * The Help window and the Help desk page are part of the web app.
 *
 *   /noo/agora/help/api/...        for anyone logged in: their own requests
 *   /noo/agora/help/api/desk/...   for Help desk admins only
 *
 * Every action needs a login (see config/policies.js). Every action checks
 * itself who may see or change what. Changes must come from the page itself:
 * it sends an X-Agora header, which another website cannot add to a request
 * made with someone's login.
 */
import Help from '../../lib/agora/help'

function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

/** Runs an action for a logged-in person, and turns HelpErrors into plain answers. */
function action (fn, { change = false } = {}) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store')
    if (change && !fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const userId = req.session && req.session.userId
    if (!userId) return res.status(401).send({ error: 'Please log in.' })
    try {
      return await fn(req, res, String(userId))
    } catch (err) {
      if (err instanceof Help.HelpError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  }
}

module.exports = {
  /** What the Help window needs: Claude on or off, admin or not, unread answers. */
  status: action(async (req, res, userId) => {
    res.ok(await Help.status(userId))
  }),

  mine: action(async (req, res, userId) => {
    res.ok({ requests: await Help.listMine(userId) })
  }),

  showMine: action(async (req, res, userId) => {
    res.ok({ request: await Help.getMine(userId, req.param('requestId')) })
  }),

  create: action(async (req, res, userId) => {
    const id = await Help.createFromForm(userId, req.body || {})
    res.ok({ id })
  }, { change: true }),

  replyMine: action(async (req, res, userId) => {
    await Help.replyMine(userId, req.param('requestId'), (req.body || {}).body)
    res.ok({ ok: true })
  }, { change: true }),

  chat: action(async (req, res, userId) => {
    const body = req.body || {}
    res.ok(await Help.chat(userId, { chatId: body.chatId, message: body.message, context: body.context }))
  }, { change: true }),

  deskList: action(async (req, res, userId) => {
    const q = req.query || {}
    res.ok(await Help.deskList(userId, { status: q.status, type: q.type }))
  }),

  deskShow: action(async (req, res, userId) => {
    res.ok({ request: await Help.deskGet(userId, req.param('requestId')) })
  }),

  deskUpdate: action(async (req, res, userId) => {
    res.ok(await Help.deskUpdate(userId, req.param('requestId'), req.body || {}))
  }, { change: true }),

  deskReply: action(async (req, res, userId) => {
    res.ok(await Help.deskReply(userId, req.param('requestId'), (req.body || {}).body))
  }, { change: true }),

  deskBuild: action(async (req, res, userId) => {
    res.ok(await Help.deskBuild(userId, req.param('requestId'), { task: (req.body || {}).task }))
  }, { change: true })
}
