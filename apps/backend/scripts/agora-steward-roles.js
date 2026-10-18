/**
 * Agora: makes sure stewards of circles may do their work (invite people,
 * remove people, manage content, change settings). Run from apps/backend:
 *
 *   node scripts/agora-steward-roles.js
 *
 * It adds the four steward responsibilities when the database lacks them,
 * and gives the Administrator, Moderator and Host roles of every circle the
 * responsibilities they should have. It only adds what is missing, so it is
 * safe to run again. The setup and update scripts run it; run it by hand when
 * a steward is told "You don't have permission to create an invitation".
 * See lib/agora/stewardRoles.js.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

async function run () {
  const { ensureStewardResponsibilities, repairCircleRoles } = require('../lib/agora/stewardRoles')
  const added = await ensureStewardResponsibilities(bookshelf.knex)
  for (const title of added) console.log(`Added the steward responsibility "${title}", which this database lacked.`)
  const circles = await repairCircleRoles()
  console.log(`Steward roles: checked ${circles} circle${circles === 1 ? '' : 's'}.`)
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error(`\nCould not check the steward roles: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
