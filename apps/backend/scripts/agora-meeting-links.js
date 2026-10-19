/**
 * Agora: makes every Meeting's video call link its own meeting room, and takes
 * any link off Events. For administrators, run in the Terminal from apps/backend:
 *
 *   node scripts/agora-meeting-links.js
 *        only shows what would change; nothing is saved
 *   node scripts/agora-meeting-links.js --apply
 *        makes the changes
 *
 * Video calls in Agora always go through a Meeting's meeting room. Meetings
 * made earlier can still have a link of their own, for example for Zoom, or
 * no link at all. This script gives each of them its meeting room as its
 * link. Events (talks, stands, gatherings with a place, see
 * lib/agora/eventKinds.js) never have a video call link. When
 * AGORA_MEET_DOMAIN is empty there is no call server, so nothing gets a video
 * call link at all. Posts that are not events never have one.
 *
 * An event whose location is only a link to another video call platform has
 * that location emptied. When the location has more in it (an address and a
 * link), the script lists it so a steward can change it by hand.
 *
 * Nobody gets an email. The calendar files of the changed events are made
 * again, so calendars show the meeting room. Safe to run again: a second run
 * finds nothing more to change. See lib/agora/meetingLink.js.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

async function run (apply) {
  const { bringPostsIntoLine } = require('../lib/agora/meetingLink')
  const { links, locations, enabled } = await bringPostsIntoLine({ apply })

  console.log(enabled
    ? `\nThe call server is ${process.env.AGORA_MEET_DOMAIN.trim()}: every Meeting's video call link becomes its meeting room, and Events get none.`
    : '\nAGORA_MEET_DOMAIN is empty, so there is no call server: Meetings and Events get no video call link at all.')

  console.log(`\nVideo call links ${apply ? 'changed' : 'to change'}: ${links.length}`)
  for (const fix of links) {
    console.log(`  post ${fix.id} "${fix.name}": ${fix.from || '(none)'}  ->  ${fix.to || '(none)'}`)
  }

  const cleared = locations.filter(l => l.cleared)
  const byHand = locations.filter(l => !l.cleared)
  console.log(`\nLocations that are only a video call link, ${apply ? 'emptied' : 'to empty'}: ${cleared.length}`)
  for (const l of cleared) console.log(`  post ${l.id} "${l.name}": ${l.location}`)
  if (byHand.length) {
    console.log(`\nLocations with a video call link and more, to change by hand: ${byHand.length}`)
    for (const l of byHand) console.log(`  post ${l.id} "${l.name}": ${l.location}`)
  }

  if (!apply && (links.length || cleared.length)) {
    console.log('\nNothing was saved. To make these changes: node scripts/agora-meeting-links.js --apply')
  }
  console.log('')
}

skiff.lift({
  start: function (argv) {
    run(Boolean(argv.apply))
      .catch(err => {
        console.error(`\nCould not check the meeting links: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
