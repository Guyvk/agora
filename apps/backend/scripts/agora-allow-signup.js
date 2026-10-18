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
 * It also adds the four things a steward may do (invite people, remove them,
 * manage content, change settings) when the database lacks them. Hylo adds
 * them in a migration, but a new Agora starts from schema.sql, which has the
 * tables and not their rows. Without them, not even the person who made a
 * circle could invite anyone to it.
 */
require('@babel/register')
const skiff = require('../lib/skiff')
const validator = require('validator')

const STEWARD_RESPONSIBILITIES = [
  ['Administration', 'Allows for editing group settings, exporting data, and deleting the group.'],
  ['Add Members', 'The ability to invite and add new people to the group, and to accept or reject join requests.'],
  ['Remove Members', 'The ability to remove a member from the group.'],
  ['Manage Content', 'Adjust group topics, custom views and manage content that contradicts the agreements of the group.']
]

async function ensureStewardResponsibilities () {
  const knex = bookshelf.knex
  for (const [title, description] of STEWARD_RESPONSIBILITIES) {
    const existing = await knex('responsibilities').where({ title, type: 'system' }).whereNull('group_id').first()
    if (!existing) {
      await knex('responsibilities').insert({ title, description, type: 'system', created_at: new Date(), updated_at: new Date() })
      console.log(`Added the steward responsibility "${title}", which this database lacked.`)
    }
  }
}

async function run (args) {
  const email = String(args[0] || '').trim().toLowerCase()
  if (!email) throw new Error('Say whose email address: node scripts/agora-allow-signup.js <email address>')
  if (!validator.isEmail(email)) throw new Error(`"${email}" is not an email address.`)

  await ensureStewardResponsibilities()

  let user = await User.query(q => q.whereRaw('lower(email) = ?', email)).fetch()
  if (user && user.get('active') && user.get('name')) {
    console.log(`\n${email} already has an account. They can log in, or choose "Forgot password" on the login page.\n`)
    return
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
