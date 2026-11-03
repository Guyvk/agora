/**
 * Agora: the server part of the shared Contacts page, see lib/agora/contacts.js.
 * The page itself is part of the web app, at /contacts.
 *
 *   /noo/agora/contacts               sends people on to /contacts
 *   /noo/agora/contacts/api/...       what the page reads and changes, as JSON
 *
 * Only Agora members (people in at least one circle) get in. Changes must come
 * from the page itself: it sends an X-Agora header, which another website
 * cannot add to a request made with someone's login.
 */
import Contacts from '../../lib/agora/contacts'
import Claims from '../../lib/agora/claims'

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

/** Who a profile is proposed to is for stewards only: other members do not see it. */
async function hideProposals (contacts, userId) {
  if (await Claims.canManage(userId)) return contacts
  return contacts.map(c => {
    const { proposed_user_id: a, proposed_at: b, proposed_user_name: n, ...rest } = c
    return rest
  })
}

module.exports = {
  /** The old address of the page: sends people on to the page in the web app. */
  page: async function (req, res) {
    return res.redirect(webUrl('/contacts'))
  },

  list: memberAction(async (req, res, userId) => {
    const q = req.query || {}
    const contacts = await Contacts.list({
      q: q.q, kind: q.kind, status: q.status, circleId: q.circle, mine: q.mine === '1', userId
    })
    res.ok({ contacts: await hideProposals(contacts, userId) })
  }),

  meta: memberAction(async (req, res, userId) => {
    res.ok({
      ...(await Contacts.meta()),
      dueCount: await Contacts.dueCount(userId),
      canMakeClaimLinks: await Claims.canManage(userId)
    })
  }),

  dueCount: memberAction(async (req, res, userId) => {
    res.ok({ count: await Contacts.dueCount(userId) })
  }),

  show: memberAction(async (req, res, userId) => {
    const contact = await Contacts.get(req.param('contactId'))
    if (!contact) return res.status(404).send({ error: 'This contact does not exist.' })
    res.ok({ contact: (await hideProposals([contact], userId))[0] })
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
  }, { change: true }),

  // Claim links for profiles (lib/agora/claims.js): stewards only
  createClaimLink: memberAction(async (req, res, userId) => {
    if (!(await Claims.canManage(userId))) return res.status(403).send({ error: 'Only stewards can make claim links.' })
    const { link } = await Claims.createLink({ contactId: req.param('contactId'), userId })
    res.ok({ link })
  }, { change: true }),

  withdrawClaimLink: memberAction(async (req, res, userId) => {
    if (!(await Claims.canManage(userId))) return res.status(403).send({ error: 'Only stewards can withdraw claim links.' })
    await Claims.withdrawLink({ contactId: req.param('contactId'), userId })
    res.ok({ ok: true })
  }, { change: true }),

  // Proposing a profile to a member (lib/agora/claims.js): stewards only
  memberChoices: memberAction(async (req, res, userId) => {
    if (!(await Claims.canManage(userId))) return res.status(403).send({ error: 'Only stewards can propose a profile.' })
    res.ok(await Claims.memberChoices({ contactId: req.param('contactId'), q: (req.query || {}).q }))
  }),

  propose: memberAction(async (req, res, userId) => {
    if (!(await Claims.canManage(userId))) return res.status(403).send({ error: 'Only stewards can propose a profile.' })
    await Claims.propose({ contactId: req.param('contactId'), memberId: (req.body || {}).userId, userId })
    res.ok({ ok: true })
  }, { change: true }),

  clearProposal: memberAction(async (req, res, userId) => {
    if (!(await Claims.canManage(userId))) return res.status(403).send({ error: 'Only stewards can clear a proposal.' })
    await Claims.clearProposal({ contactId: req.param('contactId'), userId })
    res.ok({ ok: true })
  }, { change: true })
}
