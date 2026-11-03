/**
 * Agora: catches the circle libraries up. Run from apps/backend:
 *
 *   node scripts/agora-library-backfill.js           shows what is missing, changes nothing
 *   node scripts/agora-library-backfill.js --apply   fills it in
 *
 * What it looks for:
 *   - meetings that ended before meeting notes went into the library: their
 *     transcript (and minutes) become a "Meeting notes" item in the circle of
 *     the event, with the full text saved for search and AI;
 *   - files of library items whose text was never read, or could not be read
 *     (for example because speech to text was not connected yet): they are read now.
 *
 * Safe to run again: what is already there is skipped. Reading recordings
 * costs speech-to-text minutes, so look at the list first.
 * See "Library" in README-AGORA.md and lib/agora/library.js.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

const apply = process.argv.includes('--apply')

async function run () {
  const { backfill } = require('../lib/agora/library')
  console.log(apply ? 'Filling in the libraries.' : 'Dry run: nothing is changed. Add --apply to fill in.')
  const { meetings, posts } = await backfill({ apply, log: line => console.log(line) })
  console.log(`\n${meetings.length} meeting(s) without meeting notes, ${posts.length} library item(s) with files without text.`)
  if (!apply && (meetings.length || posts.length)) console.log('Run again with --apply to fill them in.')
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error(`\nThe library catch-up stopped: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
