/**
 * Agora: links a circle to its folder in Google Drive. For administrators,
 * run in the Terminal from apps/backend:
 *
 *   node scripts/agora-drive-link.js
 *        lists the circles that are linked, and the folders in the main 7BP folder
 *   node scripts/agora-drive-link.js <circle> <folder link or id>
 *        links the circle to that folder
 *   node scripts/agora-drive-link.js <circle> --remove
 *        removes the link; the circle's Files page then says no folder is linked
 *
 * <circle> is the last part of the circle's address in Agora, for example
 * "governance" in /groups/governance. The folder must be inside the main 7BP
 * folder (AGORA_DRIVE_FOLDER_ID). Agora never links folders by name, because
 * anyone can make a circle with any name.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

async function run (args) {
  const Drive = require('../lib/agora/drive')
  const Links = require('../lib/agora/driveLinks')
  if (!Drive.isConfigured()) {
    throw new Error('Google Drive is not connected yet: see "Google Drive" in README-AGORA.md.')
  }
  const [slug, target] = args

  if (!slug) {
    const links = await Links.all()
    console.log('\nCircles linked to a Drive folder:')
    if (!links.length) console.log('  none yet')
    for (const l of links) console.log(`  ${l.slug}  (${l.name})  ->  ${l.folder_id}`)
    console.log('\nFolders in the main 7BP folder:')
    for (const f of await Drive.mainFolders()) console.log(`  ${f.id}  ${f.name}`)
    console.log('\nTo link: node scripts/agora-drive-link.js <circle> <folder id>\n')
    return
  }

  const group = await Group.findActive(slug)
  if (!group) throw new Error(`There is no circle with the address "${slug}".`)

  if (target === '--remove') {
    await Links.unlink(group.id)
    console.log(`\nThe circle "${group.get('name')}" has no Drive folder now.\n`)
    return
  }
  if (!target) throw new Error('Say which folder: its Drive link or id.')

  const folder = await Drive.folderToLink(target)
  await Links.link(group.id, folder.id, process.env.USER || 'the Terminal')
  console.log(`\nThe circle "${group.get('name')}" (${slug}) now shows the Drive folder "${folder.name}".\n`)
}

skiff.lift({
  start: function (argv) {
    run((argv._ || []).map(String).concat(argv.remove ? ['--remove'] : []))
      .catch(err => {
        console.error(`\n${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
