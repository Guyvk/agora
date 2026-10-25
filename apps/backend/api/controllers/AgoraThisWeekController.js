/**
 * Agora: the server part of "This week in 7BP" (lib/agora/thisWeek.js).
 * For anyone logged in (config/policies.js); the answer only holds what that
 * person may see.
 */
const { thisWeek } = require('../../lib/agora/thisWeek')

module.exports = {
  show: async function (req, res) {
    res.set('Cache-Control', 'no-store')
    const userId = req.session && req.session.userId
    if (!userId) return res.status(401).send({ error: 'Please log in.' })
    res.ok(await thisWeek(String(userId), req.param('group')))
  }
}
