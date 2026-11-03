/**
 * Agora: the server part of the claim page (/claim/<secret> in the web app),
 * where someone claims the profile made from their sheet. See lib/agora/claims.js.
 *
 *   GET  /noo/agora/claim/api/:token          the profile behind a claim link, for anyone who has the link
 *   POST /noo/agora/claim/api/:token/claim    the person who is logged in claims it
 *   GET  /noo/agora/claim/api/proposal            the profile proposed to me (a steward, or guessed from names), login needed
 *   POST /noo/agora/claim/api/proposal/claim      claim it without a link (X-Agora header)
 *   POST /noo/agora/claim/api/proposal/dismiss    "This isn't me": never propose it to me again
 *   POST /noo/agora/claim/api/remove-sheet-data   the person who claimed deletes the sheet data in Contacts
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

  // The profile proposed to the person who is logged in: only to them
  myProposal: async function (req, res) {
    noStore(res)
    if (tooMany(req)) return res.status(429).send({ error: 'Too many tries. Wait a minute.' })
    return res.ok({ proposal: await Claims.myProposal(req.session.userId) })
  },

  claimProposal: async function (req, res) {
    noStore(res)
    if (req.headers['x-agora'] !== '1') return res.status(400).send({ error: 'Bad request.' })
    if (tooMany(req)) return res.status(429).send({ error: 'Too many tries. Wait a minute.' })
    try {
      const contactId = (req.body || {}).contactId
      if (contactId == null) return res.status(400).send({ error: 'Bad request.' })
      return res.ok(await Claims.claim({ userId: req.session.userId, proposalContactId: contactId }))
    } catch (err) {
      if (err instanceof Contacts.ContactError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  },

  dismissProposal: async function (req, res) {
    noStore(res)
    if (req.headers['x-agora'] !== '1') return res.status(400).send({ error: 'Bad request.' })
    if (tooMany(req)) return res.status(429).send({ error: 'Too many tries. Wait a minute.' })
    try {
      return res.ok(await Claims.dismissProposal({ userId: req.session.userId, contactId: (req.body || {}).contactId }))
    } catch (err) {
      if (err instanceof Contacts.ContactError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  },

  // The person who claimed a profile deletes the sheet data in Contacts (login + X-Agora header, like claim)
  removeSheetData: async function (req, res) {
    noStore(res)
    if (req.headers['x-agora'] !== '1') return res.status(400).send({ error: 'Bad request.' })
    if (tooMany(req)) return res.status(429).send({ error: 'Too many tries. Wait a minute.' })
    try {
      return res.ok(await Claims.removeSheetData({ userId: req.session.userId }))
    } catch (err) {
      if (err instanceof Contacts.ContactError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  },

  // For the tests
  _resetLimits: () => counts.clear()
}
