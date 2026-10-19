/**
 * Agora: lets one person make an account on an invitation-only Agora without
 * an invitation to a circle. Used by scripts/agora-allow-signup.js on the
 * server, and by "Let someone in" on the admin dashboard (lib/agora/adminDashboard.js).
 *
 * It makes a sign-up link that works for 4 hours. Opening it confirms the
 * address and goes on to choosing a name and password. The same email is also
 * queued for the person (written to the log while no mailbox is connected).
 * Keep the link private: it logs in as that address.
 */
const validator = require('validator')

class AllowSignupError extends Error {
  constructor (message, { status = 400, reason } = {}) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

function cleanEmail (value) {
  const email = String(value || '').trim().toLowerCase()
  if (!email) throw new AllowSignupError('Say whose email address.', { reason: 'missing' })
  if (email.length > 254 || !validator.isEmail(email)) throw new AllowSignupError(`"${email.slice(0, 80)}" is not an email address.`, { reason: 'invalid' })
  return email
}

/**
 * Makes the sign-up link for this address.
 * Returns { email, link, alreadyHasAccount, emailQueued }. When the person
 * already has an active account, there is no link: they can log in.
 * Throws an AllowSignupError when the address is not valid, or when the
 * account was finished once and then deactivated (this never switches it back on).
 */
async function allowSignup (rawEmail, { log = () => {} } = {}) {
  const email = cleanEmail(rawEmail)

  // Stewards of circles must be able to invite: a new database made from schema.sql lacks the rows for that.
  const { ensureStewardResponsibilities, repairCircleRoles } = require('./stewardRoles')
  for (const title of await ensureStewardResponsibilities(bookshelf.knex)) {
    log(`Added the steward responsibility "${title}", which this database lacked.`)
  }
  await repairCircleRoles()

  let user = await User.query(q => q.whereRaw('lower(email) = ?', email)).fetch()
  if (user && user.get('active') && user.get('name')) {
    return { email, link: null, alreadyHasAccount: true, emailQueued: false }
  }
  // Not active but with a way to log in (a password or Google, Apple and the like): the
  // account was finished once and then switched off or deleted. An unfinished one has none.
  const finished = user && await bookshelf.knex('linked_account').where({ user_id: user.id }).first('id')
  if (finished) {
    throw new AllowSignupError(`${email} has an account that was deactivated or deleted. This does not switch it back on.`, { status: 409, reason: 'deactivated' })
  }
  // The same unfinished account that signing up with an email address makes
  if (!user) user = await User.create({ email, active: false })

  const { code, token } = await UserVerificationCode.create(email)
  const link = Frontend.Route.verifyEmail(email, token)

  let emailQueued = false
  try {
    await Queue.classMethod('Email', 'sendEmailVerification', {
      email,
      version: 'with link',
      templateData: { code, verify_url: link }
    })
    emailQueued = true
  } catch (err) {
    log(`(The email could not be queued: ${err.message}. The link works anyway.)`)
  }

  return { email, link, alreadyHasAccount: false, emailQueued }
}

module.exports = { allowSignup, cleanEmail, AllowSignupError }
