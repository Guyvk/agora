/**
 * Agora: the shared Contacts page, see lib/agora/contacts.js.
 *
 *   /noo/agora/contacts               the page
 *   /noo/agora/contacts/api/...       what the page reads and changes, as JSON
 *
 * Only Agora members (people in at least one circle) get in. Changes must come
 * from the page itself: it sends an X-Agora header, which another website
 * cannot add to a request made with someone's login.
 */
import fs from 'fs'
import path from 'path'
import Contacts from '../../lib/agora/contacts'

const PAGE_PATH = path.join(__dirname, '..', '..', 'agora', 'contacts.html')
let pageTemplate = null

function loadPage () {
  if (!pageTemplate || process.env.NODE_ENV === 'development') {
    pageTemplate = fs.readFileSync(PAGE_PATH, 'utf8')
  }
  return pageTemplate
}

function webUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

/** Runs an action for members only, and turns ContactErrors into plain answers. */
function memberAction (fn, { change = false } = {}) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store')
    if (change && !fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const userId = req.session.userId
    if (!(await Contacts.isMember(userId))) {
      return res.status(403).send({ error: 'Contacts are for Agora members.' })
    }
    try {
      return await fn(req, res, userId)
    } catch (err) {
      if (err instanceof Contacts.ContactError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  }
}

module.exports = {
  page: async function (req, res) {
    if (!UserSession.isLoggedIn(req)) {
      return res.redirect(webUrl(`/login?returnToUrl=${encodeURIComponent(req.originalUrl)}`))
    }
    const userId = req.session.userId
    res.set('Cache-Control', 'no-store')
    if (!(await Contacts.isMember(userId))) {
      return res.status(403).send('Contacts are for Agora members.')
    }
    const user = await User.find(userId)
    const boot = {
      api: '/noo/agora/contacts/api',
      homeUrl: webUrl('/'),
      me: { id: String(userId), name: user.get('name') }
    }
    // A function is used so that "$" in a name is not read as a replace pattern.
    const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c')
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(loadPage().replace('"__AGORA_BOOT__"', () => bootJson))
  },

  list: memberAction(async (req, res, userId) => {
    const q = req.query || {}
    res.ok({
      contacts: await Contacts.list({
        q: q.q, kind: q.kind, status: q.status, circleId: q.circle, mine: q.mine === '1', userId
      })
    })
  }),

  meta: memberAction(async (req, res, userId) => {
    res.ok({ ...(await Contacts.meta()), dueCount: await Contacts.dueCount(userId) })
  }),

  dueCount: memberAction(async (req, res, userId) => {
    res.ok({ count: await Contacts.dueCount(userId) })
  }),

  show: memberAction(async (req, res) => {
    const contact = await Contacts.get(req.param('contactId'))
    if (!contact) return res.status(404).send({ error: 'This contact does not exist.' })
    res.ok({ contact })
  }),

  create: memberAction(async (req, res, userId) => {
    const id = await Contacts.create(userId, req.body || {})
    res.ok({ id })
  }, { change: true }),

  update: memberAction(async (req, res, userId) => {
    const id = await Contacts.update(userId, req.param('contactId'), req.body || {})
    res.ok({ id })
  }, { change: true }),

  addNote: memberAction(async (req, res, userId) => {
    await Contacts.addNote(userId, req.param('contactId'), (req.body || {}).body)
    res.ok({ ok: true })
  }, { change: true }),

  destroy: memberAction(async (req, res, userId) => {
    await Contacts.remove(userId, req.param('contactId'))
    res.ok({ ok: true })
  }, { change: true })
}
