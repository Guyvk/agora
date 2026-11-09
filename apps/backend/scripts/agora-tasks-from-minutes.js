/**
 * Agora: makes suggested tasks from minutes that were written before this feature.
 * Run from apps/backend:
 *
 *   node scripts/agora-tasks-from-minutes.js           shows what it would make, changes nothing
 *   node scripts/agora-tasks-from-minutes.js --apply   stores the suggestions
 *
 * For every minutes post it reads the Actions list, matches each name to a member who was in
 * that meeting ("no match" when it is not clear), and prints that. With --apply it stores the
 * suggestions; nobody is emailed. Minutes posts that already have suggestions are skipped, so it
 * is safe to run again. See lib/agora/taskSuggestions.js.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

const apply = process.argv.includes('--apply')

async function run () {
  const { backfill } = require('../lib/agora/tasksFromMinutes')
  console.log(apply ? 'Storing suggested tasks.' : 'Dry run: nothing is changed. Add --apply to store them.')
  const r = await backfill({ apply, log: line => console.log(line) })
  console.log(`\n${r.posts} minutes post(s) with action points, ${r.actions} action point(s), ${r.skipped} post(s) skipped (already done).`)
  if (apply) console.log(`${r.created} suggestion(s) stored.`)
  else if (r.actions) console.log('Run again with --apply to store them.')
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error(`\nThe catch-up stopped: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
