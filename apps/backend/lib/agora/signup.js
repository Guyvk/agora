/**
 * Agora: sign-up by invitation only.
 *
 * On an invitation-only Agora, a new account can only be made by someone who
 * holds a valid invitation to a circle: the link in an invitation email (an
 * unused, unexpired invitation token) or a circle's join link (its access
 * code). People who already have an account log in as before.
 *
 * The setting is AGORA_INVITE_ONLY in apps/backend/.env:
 *   on   new accounts need an invitation
 *   off  anyone may sign up, as in Hylo
 * When it is not set, it is on for a server (NODE_ENV=production) and off on
 * a laptop and in the tests.
 *
 * Every place in Hylo that makes an account for someone who signs up asks
 * mayCreateAccount first:
 *   - signing up with an email address (GraphQL sendEmailVerification)
 *   - logging in with Google, Facebook, LinkedIn or Apple for the first time
 *     (SessionController upsertUser)
 * Accounts made by the server itself are not affected: the meeting assistant,
 * an administrator's script (scripts/agora-allow-signup.js), and Hylo's
 * server-to-server API for trusted partner apps (POST /noo/user), which
 * always puts the new person in a circle.
 */

/** The error the web app shows as "Agora is by invitation". */
const INVITE_ONLY_ERROR = 'agora-invite-only'

/** Matches the web app's existing message for an invitation that cannot be used. */
const INVITATION_INVALID_ERROR = 'invite-expired'

const ON = ['on', 'true', '1', 'yes']
const OFF = ['off', 'false', '0', 'no']

function isInviteOnly () {
  const value = String(process.env.AGORA_INVITE_ONLY || '').trim().toLowerCase()
  if (ON.includes(value)) return true
  if (OFF.includes(value)) return false
  return process.env.NODE_ENV === 'production'
}

/** A token or code as sent by a browser: a short plain string, or nothing. */
function clean (value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 255 ? trimmed : undefined
}

/** The invitation someone holds, from what they sent: { invitationToken, accessCode }. */
function invitation ({ invitationToken, accessCode } = {}) {
  return { invitationToken: clean(invitationToken), accessCode: clean(accessCode) }
}

function hasInvitation (held) {
  const { invitationToken, accessCode } = invitation(held)
  return Boolean(invitationToken || accessCode)
}

async function isActiveGroup (groupId) {
  if (!groupId) return false
  const group = await Group.where({ id: groupId, active: true }).fetch({ require: false })
  return Boolean(group)
}

/**
 * True when the invitation can be used now: an email invitation that is not
 * used or withdrawn, or the join link of a circle that still exists, in both
 * cases for a circle that has not been deleted. Uses Hylo's own check, the
 * same one the invitation page uses.
 */
async function isValidInvitation (held) {
  const InvitationService = require('../../api/services/InvitationService')
  const { invitationToken, accessCode } = invitation(held)
  if (invitationToken) {
    const result = await InvitationService.check(invitationToken, null)
    if (result?.valid && await isActiveGroup(result.groupId)) return true
  }
  if (accessCode) {
    const result = await InvitationService.check(null, accessCode)
    if (result?.valid && await isActiveGroup(result.groupId)) return true
  }
  return false
}

/** True when a new account may be made for someone holding this invitation (or none). */
async function mayCreateAccount (held) {
  if (!isInviteOnly()) return true
  return isValidInvitation(held)
}

/**
 * The invitation that came with a request: from its parameters (query or
 * body), or else the one remembered when a Google, Facebook or LinkedIn login
 * started (see rememberInvitation).
 */
function invitationFromRequest (req) {
  const param = name => (typeof req?.param === 'function' ? req.param(name) : undefined) ?? req?.body?.[name]
  const fromParams = invitation({ invitationToken: param('invitationToken'), accessCode: param('accessCode') })
  if (hasInvitation(fromParams)) return fromParams
  return invitation(req?.session?.agoraInvitation)
}

/**
 * A login with Google, Facebook or LinkedIn leaves Agora and comes back from
 * the other site. The invitation that came with its start is kept in the
 * session meanwhile.
 */
function rememberInvitation (req) {
  if (!req?.session) return
  const held = invitationFromRequest(req)
  if (hasInvitation(held)) req.session.agoraInvitation = held
}

function forgetInvitation (req) {
  if (req?.session) delete req.session.agoraInvitation
}

module.exports = {
  INVITE_ONLY_ERROR,
  INVITATION_INVALID_ERROR,
  isInviteOnly,
  hasInvitation,
  isValidInvitation,
  mayCreateAccount,
  invitationFromRequest,
  rememberInvitation,
  forgetInvitation
}
