/**
 * Agora: the server part of the calendar page (/calendar in the web app) and
 * the calendar feed. See lib/agora/calendar.js.
 *
 *   GET  /noo/agora/calendar/api/me            may I mark things for all of 7BP
 *   GET  /noo/agora/calendar/api/items         my Meetings and Events between two dates
 *   GET  /noo/agora/calendar/api/feed          my calendar link, if I made one
 *   POST /noo/agora/calendar/api/feed/renew    make a new link (the old one stops working)
 *   POST /noo/agora/calendar/api/feed/revoke   switch my link off
 *   GET  /noo/agora/calendar/<secret>.ics      the calendar feed itself, no login
 *
 * Everything but the feed needs a login (config/policies.js). Changes must
 * come from the page itself: it sends an X-Agora header, which another
 * website cannot add to a request made with someone's login.
 */
import Calendar from '../../lib/agora/calendar'

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
      if (err instanceof Calendar.CalendarError) return res.status(err.status).send({ error: err.message })
      throw err
    }
  }
}

module.exports = {
  me: action(async (req, res, userId) => {
    res.ok(await Calendar.aboutMe(userId))
  }),

  items: action(async (req, res, userId) => {
    res.ok({ items: await Calendar.itemsForPage(userId, { from: req.param('from'), to: req.param('to') }) })
  }),

  myFeed: action(async (req, res, userId) => {
    res.ok(await Calendar.myFeed(userId))
  }),

  renewFeed: action(async (req, res, userId) => {
    res.ok(await Calendar.renewFeed(userId))
  }, { change: true }),

  revokeFeed: action(async (req, res, userId) => {
    res.ok(await Calendar.revokeFeed(userId))
  }, { change: true }),

  /**
   * The calendar feed. No login: the secret in the address is the key. A
   * wrong or switched-off link gets the same short answer, and nothing about
   * it is logged.
   */
  feed: async function (req, res) {
    res.set('Cache-Control', 'private, no-store')
    res.set('Referrer-Policy', 'no-referrer')
    res.set('X-Robots-Tag', 'noindex')
    const file = String(req.param('file') || '')
    const token = file.endsWith('.ics') ? file.slice(0, -4) : file
    const userId = await Calendar.userForToken(token)
    if (!userId) return res.status(404).type('text/plain').send('This calendar link does not work (any more). Make a new one on the Calendar page in Agora.')
    const ics = await Calendar.feedFor(userId)
    res.set('Content-Disposition', 'inline; filename="agora.ics"')
    res.type('text/calendar; charset=utf-8').send(ics)
  }
}
