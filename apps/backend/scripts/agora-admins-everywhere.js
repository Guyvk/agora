/**
 * Agora: makes the Agora admins (AGORA_ADMINS in apps/backend/.env) members
 * and Administrator of every active circle and space that already exists.
 * Run from apps/backend:
 *
 *   node scripts/agora-admins-everywhere.js            shows what it would change, saves nothing
 *   node scripts/agora-admins-everywhere.js --apply    saves those changes
 *
 * Add --rejoin to also bring an admin back into circles and spaces they left
 * or were removed from (without it, those are left alone).
 *
 * It only adds what is missing, so it is safe to run again; a second run finds
 * nothing to do. New circles and spaces get the admins by themselves, and the
 * hourly cron job does this too. See lib/agora/adminsEverywhere.js.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

const apply = process.argv.includes('--apply')
const rejoin = process.argv.includes('--rejoin')

const WHAT = {
  join: 'becomes a member of',
  rejoin: 'becomes a member again of',
  administrator: 'gets the Administrator role in'
}

async function run () {
  const { addAgoraAdminsEverywhere } = require('../lib/agora/adminsEverywhere')
  const { changes, skipped, adminIds, groups } = await addAgoraAdminsEverywhere({ apply, rejoin })

  for (const entry of skipped) console.log(`Skipped "${entry}" in AGORA_ADMINS: no active account with that id or confirmed email address.`)
  if (adminIds.length === 0) {
    console.log('No Agora admins found. Put their user ids in AGORA_ADMINS in apps/backend/.env first.')
    return
  }

  const users = await bookshelf.knex('users').whereIn('id', adminIds).select('id', 'name')
  const groupRows = await bookshelf.knex('groups').whereIn('id', [...new Set(changes.map(c => c.groupId))]).select('id', 'name', 'type')
  const userName = id => (users.find(u => String(u.id) === id) || {}).name || `user ${id}`
  const groupName = id => {
    const g = groupRows.find(r => String(r.id) === id) || {}
    return `${g.type === 'space' ? 'space' : 'circle'} "${g.name || id}"`
  }

  for (const c of changes) {
    console.log(`${apply ? '' : 'Would: '}${userName(c.userId)} (${c.userId}) ${WHAT[c.change]} ${groupName(c.groupId)} (${c.groupId})`)
  }
  const n = changes.length
  console.log(`\nAgora admins: ${adminIds.map(userName).join(', ')}. Circles and spaces looked at: ${groups}.`)
  if (n === 0) console.log('Nothing to change: the Agora admins are already Administrator everywhere.')
  else if (apply) console.log(`Saved ${n} change${n === 1 ? '' : 's'}.`)
  else console.log(`${n} change${n === 1 ? '' : 's'} to make. Nothing was saved. Run again with --apply to save them.`)
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error(`\nCould not make the Agora admins Administrator everywhere: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
