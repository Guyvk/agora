/**
 * Agora: makes the 7BP Home, the main circle that holds every circle and
 * every member. Run from apps/backend:
 *
 *   node scripts/agora-main-group.js            shows what it would change, saves nothing
 *   node scripts/agora-main-group.js --apply    saves those changes
 *
 * The main circle is the one with the slug in AGORA_MAIN_GROUP_SLUG (default
 * "7bp"), named AGORA_MAIN_GROUP_NAME (default "7BP"). It only adds what is
 * missing, so running it again changes nothing. The 10-minute cron job does
 * the same with --apply. See lib/agora/mainGroup.js for the rules.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

const apply = process.argv.includes('--apply')

async function run () {
  const { ensureMainGroup } = require('../lib/agora/mainGroup')
  const r = await ensureMainGroup({ apply })
  const would = apply ? '' : 'Would: '

  if (r.blocked) {
    console.log(r.blocked)
    process.exitCode = 1
    return
  }
  if (r.main.create) {
    console.log(`${would}make the circle "${r.main.name}" (slug ${r.main.slug}), visible to its members only, joining by invitation or join link, made by ${r.main.creator.name} (${r.main.creator.id}) who becomes its Administrator`)
  } else {
    console.log(`The main circle "${r.main.name}" (slug ${r.main.slug}, ${r.main.id}) exists.`)
  }
  for (const l of r.links) console.log(`${would}make circle "${l.name}" (${l.id}) a child of the main circle`)
  for (const k of r.keptApart) console.log(`Kept apart: circle "${k.name}" (${k.id}) was taken out of the main circle on purpose, so it stays out`)
  for (const j of r.joins) console.log(`${would}make ${j.name} (${j.id}) a member of the main circle`)
  for (const l of r.leftOnPurpose) console.log(`Left on purpose: ${l.name} (${l.id}) left the main circle and is not added again`)
  for (const h of r.home) console.log(`${would}${h}`)
  console.log(`\nCircles that become children: ${r.links.length}. Accounts that become members: ${r.joins.length}. Left on purpose: ${r.leftOnPurpose.length}. Kept apart: ${r.keptApart.length}. Home page changes: ${r.home.length}.`)
  if (r.changes === 0) console.log('Nothing to change: the 7BP Home is complete.')
  else if (apply) console.log(`Saved ${r.changes} change${r.changes === 1 ? '' : 's'}.`)
  else console.log(`${r.changes} change${r.changes === 1 ? '' : 's'} to make. Nothing was saved. Run again with --apply to save them.`)
  if (r.failures.length > 0) {
    console.log(`\nCould not do ${r.failures.length} step${r.failures.length === 1 ? '' : 's'}:`)
    for (const f of r.failures) console.log(`  ${f.step}: ${f.message}`)
    process.exitCode = 1
  }
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error(`\nCould not make the 7BP Home: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
