/**
 * Agora: the server part of the admin dashboard, see lib/agora/adminDashboard.js.
 * The page itself is part of the web app, at /admin.
 *
 *   /noo/agora/admin/api/...   for Agora admins only (AGORA_ADMINS)
 *
 * Every action needs a login (see config/policies.js), and every action checks
 * itself that the person is an Agora admin; anyone else is told the page does
 * not exist. The one exception is "me", which only tells someone whether they
 * themselves are an admin, so the menu knows whether to show the link.
 * Every request, also for reading, must come from the page itself: it sends an
 * X-Agora header, which another website cannot add to a request made with
 * someone's login.
 */
import Dashboard from '../../lib/agora/adminDashboard'

function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

/** Every action, also reading, needs the X-Agora header: the answers hold invitation links. */
function action (fn) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store')
    if (!fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const userId = req.session && req.session.userId
    if (!userId) return res.status(401).send({ error: 'Please log in.' })
    try {
      return await fn(req, res, String(userId))
    } catch (err) {
      if (err instanceof Dashboard.AdminError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  }
}

const q = req => req.query || {}
const b = req => req.body || {}

module.exports = {
  me: action(async (req, res, userId) => {
    res.ok(await Dashboard.me(userId))
  }),

  overview: action(async (req, res, userId) => {
    res.ok(await Dashboard.overview(userId))
  }),

  invitations: action(async (req, res, userId) => {
    res.ok(await Dashboard.invitations(userId, { status: q(req).status, circle: q(req).circle, page: q(req).page }))
  }),

  resendInvitation: action(async (req, res, userId) => {
    res.ok(await Dashboard.resendInvitation(userId, req.param('invitationId')))
  }),

  revokeInvitation: action(async (req, res, userId) => {
    res.ok(await Dashboard.revokeInvitation(userId, req.param('invitationId')))
  }),

  joins: action(async (req, res, userId) => {
    res.ok(await Dashboard.joins(userId))
  }),

  accounts: action(async (req, res, userId) => {
    res.ok(await Dashboard.accounts(userId, { search: q(req).search, state: q(req).state, page: q(req).page }))
  }),

  letIn: action(async (req, res, userId) => {
    res.ok(await Dashboard.letIn(userId, { email: b(req).email, circle: b(req).circle }))
  }),

  deactivate: action(async (req, res, userId) => {
    res.ok(await Dashboard.deactivate(userId, req.param('accountId')))
  }),

  reactivate: action(async (req, res, userId) => {
    res.ok(await Dashboard.reactivate(userId, req.param('accountId')))
  }),

  system: action(async (req, res, userId) => {
    res.ok(await Dashboard.system(userId))
  }),

  activity: action(async (req, res, userId) => {
    res.ok(await Dashboard.activity(userId, { page: q(req).page }))
  })
}
