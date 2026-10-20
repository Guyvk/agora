/**
 * Agora: sign-up by invitation only.
 *
 * On an invitation-only Agora, a new account can only be made by someone who
 * holds a valid invitation to a circle:
 *   - the link in an invitation email (an invitation token that is not used
 *     or withdrawn). It only makes an account for the address the invitation
 *     was sent to, so a forwarded link cannot make accounts for others.
 *   - a circle's join link (its access code). Anyone who has it may make an
 *     account, with any address, until a steward makes a new link.
 *   - a claim link for a profile made from someone's sheet (lib/agora/claims.js).
 *     Like a join link it has no address; it works until the profile is
 *     claimed or the link is withdrawn. It is not an invitation to a circle.
 * People who already have an account log in as before.
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

function settingValue () {
  return String(process.env.AGORA_INVITE_ONLY || '').trim().toLowerCase()
}

function isInviteOnly () {
  const value = settingValue()
  if (ON.includes(value)) return true
  if (OFF.includes(value)) return false
  return process.env.NODE_ENV === 'production'
}

/** A setting that is neither on nor off is a typing mistake: say so when Agora starts. */
function warnAboutSetting () {
  const value = settingValue()
  if (value && !ON.includes(value) && !OFF.includes(value)) {
    console.warn(`Agora: AGORA_INVITE_ONLY="${process.env.AGORA_INVITE_ONLY}" is not "on" or "off". ` +
      `Using the default: sign-up by invitation only is ${isInviteOnly() ? 'ON' : 'OFF'}.`)
  }
}
warnAboutSetting()

/** An email address as Agora compares them: trimmed and in small letters. */
function sameAddress (a, b) {
  const norm = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')
  return Boolean(norm(a)) && norm(a) === norm(b)
}

/** A token or code as sent by a browser: a short plain string, or nothing. */
function clean (value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 255 ? trimmed : undefined
}

/** The invitation someone holds, from what they sent: { invitationToken, accessCode, claimToken }. */
function invitation ({ invitationToken, accessCode, claimToken } = {}) {
  return { invitationToken: clean(invitationToken), accessCode: clean(accessCode), claimToken: clean(claimToken) }
}

function hasInvitation (held) {
  const { invitationToken, accessCode, claimToken } = invitation(held)
  return Boolean(invitationToken || accessCode || claimToken)
}

async function isActiveGroup (groupId) {
  if (!groupId) return false
  const group = await Group.where({ id: groupId, active: true }).fetch({ require: false })
  return Boolean(group)
}

/**
 * True when the invitation can be used now, by the person with this email
 * address: an email invitation that is not used or withdrawn and was sent to
 * this address, or the join link of a circle, in both cases for a circle that
 * has not been deleted. Uses Hylo's own check, the same one the invitation
 * page uses.
 */
async function isValidInvitation (held, email) {
  const InvitationService = require('../../api/services/InvitationService')
  const { invitationToken, accessCode, claimToken } = invitation(held)
  if (invitationToken) {
    const result = await InvitationService.check(invitationToken, null)
    if (result?.valid && sameAddress(email, result.email) && await isActiveGroup(result.groupId)) return true
  }
  if (accessCode) {
    const result = await InvitationService.check(null, accessCode)
    if (result?.valid && await isActiveGroup(result.groupId)) return true
  }
  // A claim link for a profile: any address, until the profile is claimed (lib/agora/claims.js)
  if (claimToken && await require('./claims').isValidToken(claimToken)) return true
  return false
}

/** The error when someone logged in with another address tries to use an email invitation. */
const INVITATION_OTHER_ACCOUNT_ERROR = 'agora-invitation-other-account'

/**
 * True when someone logged in with userEmail may use an invitation that was
 * sent to invitationEmail. An email invitation belongs to the address it was
 * sent to, also for people who already have an account: Guy, logged in as
 * himself, cannot use an invitation he sent to someone else, and so cannot
 * take that person's place. A join link has no address and fits everyone.
 * Only while sign-up is by invitation only, as everything in this file.
 */
function invitationFitsUser (invitationEmail, userEmail) {
  if (!isInviteOnly() || !invitationEmail) return true
  return sameAddress(invitationEmail, userEmail)
}

/** Throws when the invitation may not be used by this user (see invitationFitsUser). */
function checkInvitationFitsUser (invitationEmail, user) {
  const userEmail = user && typeof user.get === 'function' ? user.get('email') : user?.email
  if (!invitationFitsUser(invitationEmail, userEmail)) {
    const { GraphQLError } = require('graphql')
    throw new GraphQLError(INVITATION_OTHER_ACCOUNT_ERROR)
  }
}

/** True when a new account may be made for this address, holding this invitation (or none). */
async function mayCreateAccount (held, email) {
  if (!isInviteOnly()) return true
  return isValidInvitation(held, email)
}

/**
 * The invitation that came with a request, from its parameters (query or
 * body). Agora's web app never sends one with a Google, Facebook or LinkedIn
 * login (it does not show those buttons), so a first login with one of those
 * is always refused while sign-up is by invitation only. An app that logs in
 * with Apple or a phone token may send invitationToken or accessCode.
 */
function invitationFromRequest (req) {
  const param = name => (typeof req?.param === 'function' ? req.param(name) : undefined) ?? req?.body?.[name]
  // A claim link is left out on purpose: it is only for signing up with an email address
  return invitation({ invitationToken: param('invitationToken'), accessCode: param('accessCode') })
}

module.exports = {
  INVITE_ONLY_ERROR,
  INVITATION_INVALID_ERROR,
  INVITATION_OTHER_ACCOUNT_ERROR,
  invitationFitsUser,
  checkInvitationFitsUser,
  isInviteOnly,
  hasInvitation,
  isValidInvitation,
  mayCreateAccount,
  invitationFromRequest,
  sameAddress
}
