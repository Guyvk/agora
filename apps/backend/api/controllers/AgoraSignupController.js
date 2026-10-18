/**
 * Agora: tells the sign-up page whether this Agora is by invitation only, so
 * it can explain that before anyone types an email address. The server
 * checks the invitation itself as well, see lib/agora/signup.js.
 *
 *   GET /noo/agora/signup     { "inviteOnly": true } or { "inviteOnly": false }
 */
import AgoraSignup from '../../lib/agora/signup'

module.exports = {
  policy: function (req, res) {
    res.set('Cache-Control', 'no-store')
    return res.ok({ inviteOnly: AgoraSignup.isInviteOnly() })
  }
}
