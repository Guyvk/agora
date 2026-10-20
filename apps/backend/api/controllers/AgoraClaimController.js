/**
 * Agora: the server part of the claim page (/claim/<secret> in the web app),
 * where someone claims the profile made from their sheet. See lib/agora/claims.js.
 *
 *   GET  /noo/agora/claim/api/:token          the profile behind a claim link, for anyone who has the link
 *   POST /noo/agora/claim/api/:token/claim    the person who is logged in claims it
 *
 * Reading needs no login: the person may not have an account yet, and the
 * link's secret is the permission. It shows only the profile (name, country,
 * what they do, why they are here, skills, photo), never email, phone or notes.
 * Claiming needs a login, and must come from the page itself: it sends an
 * X-Agora header, which another website cannot add to a request made with
 * someone's login.
 */
import Claims from '../../lib/agora/claims'
import Contacts from '../../lib/agora/contacts'

// Calls per internet address per minute. The counts live in memory, so a restart resets them.
const LIMIT_PER_MINUTE = 30
const counts = new Map()

function tooMany (req) {
  const key = req.ip || 'unknown'
  const now = Date.now()
  const entry = counts.get(key)
  if (!entry || now - entry.start > 60 * 1000) {
    counts.set(key, { start: now, count: 1 })
    if (counts.size > 10000) counts.clear()
    return false
  }
  entry.count += 1
  return entry.count > LIMIT_PER_MINUTE
}

function noStore (res) {
  res.set('Cache-Control', 'no-store')
  res.set('Referrer-Policy', 'no-referrer')
}

module.exports = {
  show: async function (req, res) {
    noStore(res)
    if (tooMany(req)) return res.status(429).send({ error: 'Too many tries. Wait a minute.' })
    const profile = await Claims.preview(req.param('token'))
    if (!profile) return res.status(404).send({ error: 'This claim link does not work.' })
    return res.ok({ profile })
  },

  claim: async function (req, res) {
    noStore(res)
    if (req.headers['x-agora'] !== '1') return res.status(400).send({ error: 'Bad request.' })
    if (tooMany(req)) return res.status(429).send({ error: 'Too many tries. Wait a minute.' })
    try {
      const result = await Claims.claim({ secret: req.param('token'), userId: req.session.userId })
      return res.ok(result)
    } catch (err) {
      if (err instanceof Contacts.ContactError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  },

  // For the tests
  _resetLimits: () => counts.clear()
}
