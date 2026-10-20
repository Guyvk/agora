/**
 * Agora: puts the profiles from the activist council's sheets into Contacts,
 * as contacts of the kind "team" that the people can claim later. For
 * administrators, run in the Terminal from apps/backend:
 *
 *   node scripts/agora-import-profiles.js <CSV file> --photos <photos folder> --dry-run
 *        checks everything and says what it would do, without changing anything
 *   node scripts/agora-import-profiles.js <CSV file> --photos <photos folder>
 *        does it
 *
 * Other options:
 *   --source <text>   what goes in "where the details came from" (default activist-council-2026)
 *   --by <user id>    who the change log names (default: nobody, it says "Someone")
 *
 * The CSV file has the columns name, country, what_i_do_and_can_do,
 * why_i_am_here, photo, original_file. Running it twice adds nobody twice:
 * a contact with the same name and source is updated, and keeps its photo.
 * See lib/agora/importProfiles.js, and "Profiles people can claim later" in
 * README-AGORA.md. Then make each person a claim link on the Contacts page.
 */
require('@babel/register')
const path = require('path')
const skiff = require('../lib/skiff')

function parseArgs (args) {
  const options = { dryRun: false }
  const rest = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--photos') options.photosDir = args[++i]
    else if (arg === '--source') options.source = args[++i]
    else if (arg === '--by') options.userId = args[++i]
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`)
    else rest.push(arg)
  }
  if (rest.length !== 1) {
    throw new Error('Say which CSV file: node scripts/agora-import-profiles.js <CSV file> --photos <photos folder> [--dry-run]')
  }
  options.csvPath = path.resolve(rest[0])
  if (options.photosDir) options.photosDir = path.resolve(options.photosDir)
  if (options.userId && !/^\d+$/.test(options.userId)) throw new Error('--by needs a user id (a number).')
  return options
}

async function run (args) {
  const options = parseArgs(args)
  const { importProfiles } = require('../lib/agora/importProfiles')
  console.log(`\n${options.dryRun ? 'Dry run: nothing is changed.' : 'Importing.'} ${options.csvPath}\n`)
  const s = await importProfiles({ ...options, log: line => console.log(line) })
  const would = options.dryRun ? 'would be ' : ''
  console.log(`\n${s.total} rows: ${s.added} ${would}added, ${s.updated} ${would}updated, ${s.unchanged} unchanged, ` +
    `${s.claimed} claimed already (left alone), ${s.photos} photos ${would}stored, ${s.problems.length} with a problem.`)
  if (s.problems.length) {
    console.log('\nProblems (these rows were skipped):')
    for (const p of s.problems) console.log(`  line ${p.line} (${p.name || 'no name'}): ${p.message}`)
    process.exitCode = 1
  }
  if (options.dryRun) console.log('\nRun it again without --dry-run to do it.')
  console.log('')
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
