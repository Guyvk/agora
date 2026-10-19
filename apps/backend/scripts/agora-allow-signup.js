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
 * Only someone with access to the server, or an Agora admin on the admin
 * dashboard ("Let someone in", see lib/agora/allowSignup.js), can do this.
 * Once there is a circle, invite people from the circle instead.
 *
 * It also checks that stewards of circles may invite people, as
 * scripts/agora-steward-roles.js does: a new database made from schema.sql
 * lacks the rows for that.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

async function run (args) {
  if (!String(args[0] || '').trim()) throw new Error('Say whose email address: node scripts/agora-allow-signup.js <email address>')
  // The same code as "Let someone in" on the admin dashboard
  const { allowSignup } = require('../lib/agora/allowSignup')
  const { email, link, alreadyHasAccount } = await allowSignup(args[0], { log: line => console.log(line) })
  if (alreadyHasAccount) {
    console.log(`\n${email} already has an account. They can log in, or choose "Forgot password" on the login page.\n`)
    return
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
