/**
 * Agora: makes the Agora admins (AGORA_ADMINS in apps/backend/.env) members
 * and Administrator of every active circle and space that already exists.
 * Run from apps/backend:
 *
 *   node scripts/agora-admins-everywhere.js            shows what it would change, saves nothing
 *   node scripts/agora-admins-everywhere.js --apply    saves those changes
 *   node scripts/agora-admins-everywhere.js --remove <id> [--apply]
 *                                                      takes back what this gave one
 *                                                      person (see below); a dry run
 *                                                      without --apply
 *
 * Admins who left a circle or space, or were removed from it, are brought
 * back too ("becomes a member again of"): Agora admins are always in.
 *
 * It only adds what is missing, so it is safe to run again; a second run finds
 * nothing to do. Entries in AGORA_ADMINS must be user ids; email addresses are
 * ignored (and named in the log). New circles and spaces get the admins by themselves, and the
 * hourly cron job does this too. See lib/agora/adminsEverywhere.js.
 *
 * Taking someone out of AGORA_ADMINS only stops them being added again. To also
 * take back what they were given, first remove them from AGORA_ADMINS, then
 * run --remove <id>: it removes the Administrator role and the membership in
 * every circle and space that this feature put them in (the ones marked
 * agoraAdminAutoJoined). Memberships and roles they had on their own stay.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

const apply = process.argv.includes('--apply')
const removeIndex = process.argv.indexOf('--remove')
const removeId = removeIndex === -1 ? null : process.argv[removeIndex + 1]

const WHAT = {
  join: 'becomes a member of',
  rejoin: 'becomes a member again of',
  administrator: 'gets the Administrator role in'
}

async function runRemove () {
  const { removeAgoraAdminFromEverywhere } = require('../lib/agora/adminsEverywhere')
  if (!removeId || !/^\d+$/.test(removeId)) {
    throw new Error('--remove needs the account\'s number, for example: --remove 12')
  }
  const user = await bookshelf.knex('users').where('id', removeId).first('id', 'name')
  if (!user) throw new Error(`There is no account with the number ${removeId}.`)
  if ((process.env.AGORA_ADMINS || '').split(',').map(e => e.trim()).includes(removeId)) {
    console.log(`Warning: ${user.name} (${user.id}) is still in AGORA_ADMINS, so the hourly check will make them Administrator everywhere again. Remove the number from AGORA_ADMINS first.\n`)
  }
  const { changes, kept, failures } = await removeAgoraAdminFromEverywhere(removeId, { apply })
  const groupRows = await bookshelf.knex('groups').whereIn('id', changes.map(c => c.groupId)).select('id', 'name', 'type')
  for (const c of changes) {
    const g = groupRows.find(r => String(r.id) === c.groupId) || {}
    console.log(`${apply ? '' : 'Would: '}take ${user.name} (${user.id}) out of ${g.type === 'space' ? 'space' : 'circle'} "${g.name || c.groupId}" (${c.groupId}) and remove the Administrator role there`)
  }
  for (const f of failures) console.log(`Could not update group ${f.groupId}: ${f.message}`)
  const n = changes.length
  console.log(`\nMemberships ${user.name} had on their own and that stay: ${kept.length}.`)
  if (n === 0) console.log('Nothing to take back: this feature did not put them anywhere.')
  else if (apply) console.log(`Took them out of ${n - failures.length} place${n - failures.length === 1 ? '' : 's'}.`)
  else console.log(`${n} change${n === 1 ? '' : 's'} to make. Nothing was saved. Run again with --apply to save them.`)
  if (failures.length > 0) process.exitCode = 1
}

async function run () {
  if (removeIndex !== -1) return runRemove()
  const { addAgoraAdminsEverywhere } = require('../lib/agora/adminsEverywhere')
  const { changes, skipped, adminIds, groups, failures } = await addAgoraAdminsEverywhere({ apply })

  for (const entry of skipped) console.log(`Skipped "${entry}" in AGORA_ADMINS: no active account with that number.`)
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
  if (failures.length > 0) {
    console.log(`\nCould not update ${failures.length} group${failures.length === 1 ? '' : 's'}:`)
    for (const f of failures) console.log(`  group ${f.groupId}: ${f.message}`)
    process.exitCode = 1
  }
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
