/* eslint-env mocha */
/**
 * Agora: putting profiles from a spreadsheet into Contacts
 * (lib/agora/importProfiles.js, scripts/agora-import-profiles.js).
 * The people and the pictures here are made up; the pictures are drawn by the test.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/importProfiles.test.js
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { importProfiles, DEFAULT_SOURCE } from '../../../lib/agora/importProfiles'
import * as diskUploads from '../../../lib/agora/diskUploads'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))

const HEADER = 'name,country,what_i_do_and_can_do,why_i_am_here,photo,original_file'
const ROWS = [
  'Tess Testperson,Made-up Land,"draws maps, cooks for 40 people",to learn,Tess.jpg,0001.jpg',
  'Uri Example,Nowhere (born in Elsewhere),"plays the drum; ""can"" teach",because,Uri.png,0002.jpg',
  'Vera Placeholder,Fictionia,,,,'
]

describe('Agora import of profiles', () => {
  let dir, csvPath, photosDir, saved
  const knex = () => bookshelf.knex
  const contacts = () => knex()('agora_contacts').where({ source: DEFAULT_SOURCE }).orderBy('name')

  function writeCsv (rows) {
    fs.writeFileSync(csvPath, [HEADER, ...rows].join('\n') + '\n')
  }

  before(async () => {
    saved = { PROTOCOL: process.env.PROTOCOL, DOMAIN: process.env.DOMAIN }
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    await setup.clearDb()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-import-test-'))
    csvPath = path.join(dir, 'profiles.csv')
    photosDir = path.join(dir, 'Photos')
    fs.mkdirSync(photosDir)
    // A big picture with a made-up camera note, as a phone would make
    const big = { create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 40 } } }
    await sharp(big).withMetadata({ exif: { IFD0: { Make: 'MadeUpCam', Model: 'Test 1' } } }).jpeg().toFile(path.join(photosDir, 'Tess.jpg'))
    await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 10, g: 90, b: 160 } } }).png().toFile(path.join(photosDir, 'Uri.png'))
    writeCsv(ROWS)
  })

  after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('changes nothing in a dry run, and says what it would do', async () => {
    const lines = []
    const summary = await importProfiles({ csvPath, photosDir, dryRun: true, log: l => lines.push(l) })
    expect(summary).to.deep.include({ total: 3, added: 3, updated: 0, unchanged: 0, claimed: 0, photos: 2 })
    expect(summary.problems).to.deep.equal([])
    expect(await contacts()).to.have.length(0)
    expect(lines.join('\n')).to.contain('would add: Tess Testperson (with photo)')
  })

  it('adds team contacts with their profile and a small photo without hidden details', async () => {
    const summary = await importProfiles({ csvPath, photosDir })
    expect(summary).to.deep.include({ total: 3, added: 3, updated: 0, unchanged: 0, photos: 2 })
    const rows = await contacts()
    expect(rows.map(r => r.name)).to.deep.equal(['Tess Testperson', 'Uri Example', 'Vera Placeholder'])
    const [tess, uri, vera] = rows
    expect(tess).to.include({ kind: 'team', status: 'new', consent: false, country: 'Made-up Land', offers: 'draws maps, cooks for 40 people', why_here: 'to learn', skills: null, claimed_user_id: null })
    expect(uri.offers).to.equal('plays the drum; "can" teach')
    expect(vera.photo_url).to.equal(null)
    expect(vera.offers).to.equal(null)

    // The photo is with the other uploads, under a random name, at most 1200 pixels, without the camera note
    expect(tess.photo_url).to.match(/^https:\/\/agora\.example\.org\/noo\/uploads\/.+\/agoraContactPhoto\/\d+\/photo_[0-9a-f]{24}\.jpg$/)
    expect(tess.photo_url).to.not.contain('Tess')
    const file = diskUploads.filePath(diskUploads.keyFromUrl(tess.photo_url))
    const info = await sharp(file).metadata()
    expect(info.format).to.equal('jpeg')
    expect(Math.max(info.width, info.height)).to.equal(1200)
    expect(info.exif).to.equal(undefined)
    expect(fs.readFileSync(file).includes('MadeUpCam')).to.equal(false)

    const log = await knex()('agora_contact_changes').where({ contact_id: tess.id }).orderBy('id').pluck('action')
    expect(log).to.deep.equal(['created', 'updated'])
  })

  it('adds nobody twice and keeps the photos when run again', async () => {
    const before = await contacts()
    const files = fs.readdirSync(path.dirname(diskUploads.filePath(diskUploads.keyFromUrl(before[0].photo_url))))
    const summary = await importProfiles({ csvPath, photosDir })
    expect(summary).to.deep.include({ total: 3, added: 0, updated: 0, unchanged: 3, photos: 0 })
    const after = await contacts()
    expect(after.map(r => [r.id, r.photo_url])).to.deep.equal(before.map(r => [r.id, r.photo_url]))
    expect(fs.readdirSync(path.dirname(diskUploads.filePath(diskUploads.keyFromUrl(after[0].photo_url))))).to.deep.equal(files)
  })

  it('updates a changed row, and leaves a claimed profile alone', async () => {
    const someone = await new User({ name: 'Uri', email: 'uri@agora.test', active: true }).save()
    await knex()('agora_contacts').where({ name: 'Uri Example' }).update({ claimed_user_id: someone.id, claimed_at: new Date() })
    writeCsv([
      'Tess Testperson,Made-up Land,"draws maps, cooks for 50 people",to learn,Tess.jpg,0001.jpg',
      'Uri Example,Changed Land,changed,changed,Uri.png,0002.jpg',
      'Vera Placeholder,Fictionia,,,,'
    ])
    const summary = await importProfiles({ csvPath, photosDir })
    expect(summary).to.deep.include({ added: 0, updated: 1, unchanged: 1, claimed: 1 })
    const [tess, uri] = await contacts()
    expect(tess.offers).to.equal('draws maps, cooks for 50 people')
    expect(uri.country).to.equal('Nowhere (born in Elsewhere)')
    writeCsv(ROWS)
  })

  it('skips rows with a problem and says why', async () => {
    writeCsv([
      ',No Name Land,x,y,,',
      'Wim Missing,Somewhere,x,y,Wim.jpg,0003.jpg',
      'Xena Sneaky,Somewhere,x,y,../profiles.csv,0004.jpg'
    ])
    const summary = await importProfiles({ csvPath, photosDir })
    expect(summary.added).to.equal(0)
    expect(summary.problems.map(p => [p.line, p.message])).to.deep.equal([
      [2, 'A name is needed.'],
      [3, 'Photo "Wim.jpg" is not in the photos folder.'],
      [4, 'Photo "../profiles.csv" is not a plain file name.']
    ])
    expect(await knex()('agora_contacts').whereIn('name', ['Wim Missing', 'Xena Sneaky'])).to.have.length(0)
    writeCsv(ROWS)
  })

  it('refuses a CSV file without the needed columns', async () => {
    const other = path.join(dir, 'other.csv')
    fs.writeFileSync(other, 'name,email\nSomeone,someone@agora.test\n')
    await expect(importProfiles({ csvPath: other, photosDir })).to.be.rejectedWith('lacks the column(s): country')
  })
})
