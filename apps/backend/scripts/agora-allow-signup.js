/**
 * Agora: lets one person make an account on an invitation-only Agora without
 * an invitation to a circle. For administrators, run on the server from
 * apps/backend:
 *
 *   node scripts/agora-allow-signup.js <email address>
 *
 * This is how the very first person gets in on an empty server, where there
 * are no circles yet and so nobody can invite. It prints a sign-up link that
 * works for 4 hours. Opening it confirms the address and goes on to choosing
 * a name and password. The same email is also sent to the person (or written
 * to the log while no mailbox is connected).
 *
 * Only someone with access to the server can do this. Nothing on the website
 * can. Once there is a circle, invite people from the circle instead.
 *
 * It also checks that stewards of circles may invite people, as
 * scripts/agora-steward-roles.js does: a new database made from schema.sql
 * lacks the rows for that.
 */
require('@babel/register')
const skiff = require('../lib/skiff')
const validator = require('validator')

async function run (args) {
  const email = String(args[0] || '').trim().toLowerCase()
  if (!email) throw new Error('Say whose email address: node scripts/agora-allow-signup.js <email address>')
  if (!validator.isEmail(email)) throw new Error(`"${email}" is not an email address.`)

  const { ensureStewardResponsibilities, repairCircleRoles } = require('../lib/agora/stewardRoles')
  for (const title of await ensureStewardResponsibilities(bookshelf.knex)) {
    console.log(`Added the steward responsibility "${title}", which this database lacked.`)
  }
  await repairCircleRoles()

  let user = await User.query(q => q.whereRaw('lower(email) = ?', email)).fetch()
  if (user && user.get('active') && user.get('name')) {
    console.log(`\n${email} already has an account. They can log in, or choose "Forgot password" on the login page.\n`)
    return
  }
  // Not active but with a way to log in (a password or Google, Apple and the like): the
  // account was finished once and then switched off or deleted. An unfinished one has none.
  const finished = user && await bookshelf.knex('linked_account').where({ user_id: user.id }).first('id')
  if (finished) {
    throw new Error(`${email} has an account that was deactivated or deleted. This script does not switch it back on.`)
  }
  // The same unfinished account that signing up with an email address makes
  if (!user) user = await User.create({ email, active: false })

  const { code, token } = await UserVerificationCode.create(email)
  const link = Frontend.Route.verifyEmail(email, token)

  try {
    await Queue.classMethod('Email', 'sendEmailVerification', {
      email,
      version: 'with link',
      templateData: { code, verify_url: link }
    })
  } catch (err) {
    console.log(`(The email could not be queued: ${err.message}. The link below works anyway.)`)
  }

  console.log(`\n${email} may now make an account. Open this link within 4 hours, or send it to them:\n\n  ${link}\n`)
  console.log('It confirms the address and goes on to choosing a name and password. Keep the link private: it logs in as that address.\n')
}

skiff.lift({
  start: function () {
    run(process.argv.slice(2))
      .catch(err => {
        console.error(`\n${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
