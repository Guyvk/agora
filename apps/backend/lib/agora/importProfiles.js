/**
 * Agora: puts profiles from a spreadsheet into Contacts, as contacts of the
 * kind "team" that the people can claim later (lib/agora/claims.js).
 * Used by scripts/agora-import-profiles.js.
 *
 * The spreadsheet is a CSV file with these columns:
 *   name, country, what_i_do_and_can_do, why_i_am_here, photo, original_file
 * "photo" is the name of a picture in the photos folder. original_file is not used.
 *
 * Each row becomes one contact with source "activist-council-2026" (or what
 * --source says). Running it again changes nothing new: a contact with the
 * same name and source is updated instead of added twice, and its photo is
 * kept. A profile that someone has claimed already is left alone.
 *
 * Photos are turned upright, made at most 1200 pixels wide or high, saved as
 * JPEG without their hidden details (camera, date, GPS place), and stored
 * with Agora's other uploads (lib/agora/diskUploads.js) under a random name.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { parse } from 'csv/lib/sync'
import * as diskUploads from './diskUploads'

const Contacts = require('./contacts')

export const DEFAULT_SOURCE = 'activist-council-2026'
const COLUMNS = ['name', 'country', 'what_i_do_and_can_do', 'why_i_am_here', 'photo']
const PHOTO_MAX = 1200
const PHOTO_TYPES = /\.(jpe?g|png|webp|gif|tiff?|heic|heif)$/i

const knex = () => bookshelf.knex

/** Reads the CSV file into rows. Throws when a needed column is missing. */
export function readRows (csvPath) {
  const rows = parse(fs.readFileSync(csvPath), { columns: header => header.map(h => String(h).trim().toLowerCase()), bom: true, skip_empty_lines: true, trim: true })
  const header = rows.length ? Object.keys(rows[0]) : []
  const missing = COLUMNS.filter(c => !header.includes(c))
  if (rows.length && missing.length) throw new Error(`The CSV file lacks the column(s): ${missing.join(', ')}`)
  return rows
}

/** The storage key for a contact's photo: random, so it says nothing about the person. */
function photoKey (contactId) {
  const prefix = process.env.UPLOADER_PATH_PREFIX || 'evo-uploads'
  return [prefix, 'user', 'system', 'agoraContactPhoto', String(contactId), `photo_${crypto.randomBytes(12).toString('hex')}.jpg`].join('/')
}

/** Makes the photo small and upright, without its hidden details, and stores it. Returns its address. */
async function storePhoto (file, contactId) {
  const data = await sharp(file)
    .rotate() // upright, from the camera's own note
    .resize({ width: PHOTO_MAX, height: PHOTO_MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 }) // sharp leaves out the camera details and GPS place unless asked to keep them
    .toBuffer()
  const { url } = await diskUploads.writeString(data, photoKey(contactId))
  return url
}

/** The photo file for a row, or null. Refuses names that point outside the photos folder. */
function photoFile (photosDir, name) {
  if (!name) return null
  if (!photosDir) throw new Error('The CSV names photos, but no photos folder was given (--photos <folder>).')
  if (name.includes('/') || name.includes('\\') || name.startsWith('.')) throw new Error(`Photo "${name}" is not a plain file name.`)
  if (!PHOTO_TYPES.test(name)) throw new Error(`Photo "${name}" is not a picture.`)
  const full = path.join(photosDir, name)
  if (!fs.existsSync(full)) throw new Error(`Photo "${name}" is not in the photos folder.`)
  return full
}

/**
 * Imports the rows. Options:
 *   csvPath     the CSV file
 *   photosDir   the folder with the photos (needed when the CSV names photos)
 *   source      what goes in "where the details came from"
 *   dryRun      true: check and report, change nothing
 *   userId      who the change log names (null: "Someone", for a script on the server)
 *   log         where to write each line (console.log)
 * Returns { added, updated, unchanged, claimed, photos, problems, total }.
 */
export async function importProfiles ({ csvPath, photosDir, source = DEFAULT_SOURCE, dryRun = false, userId = null, log = () => {} }) {
  if (!diskUploads.inUse()) throw new Error('Photos can only be stored on Agora\'s own disk; this Agora uses Amazon S3.')
  const rows = readRows(csvPath)
  const summary = { total: rows.length, added: 0, updated: 0, unchanged: 0, claimed: 0, photos: 0, problems: [] }

  for (const [index, row] of rows.entries()) {
    const line = index + 2 // the header is line 1
    try {
      const values = await Contacts.clean({
        name: row.name,
        kind: 'team',
        source,
        country: row.country,
        offers: row.what_i_do_and_can_do,
        why_here: row.why_i_am_here
      })
      const file = photoFile(photosDir, row.photo)
      const existing = await knex()('agora_contacts')
        .whereRaw('lower(name) = lower(?)', [values.name])
        .where({ source })
        .first('id', 'name', 'country', 'offers', 'why_here', 'kind', 'photo_url', 'claimed_user_id')

      if (existing && existing.claimed_user_id) {
        summary.claimed++
        log(`  claimed already, left alone: ${values.name}`)
        continue
      }

      const fields = ['country', 'offers', 'why_here', 'kind']
      const changed = existing ? fields.filter(f => (existing[f] || null) !== (values[f] || null)) : fields
      const needsPhoto = Boolean(file) && !(existing && existing.photo_url && photoStillThere(existing.photo_url))

      if (dryRun) {
        if (!existing) summary.added++
        else if (changed.length) summary.updated++
        else if (!needsPhoto) summary.unchanged++
        else summary.updated++
        if (needsPhoto) summary.photos++
        log(`  ${!existing ? 'would add' : changed.length || needsPhoto ? 'would update' : 'unchanged'}: ${values.name}${needsPhoto ? ' (with photo)' : ''}`)
        continue
      }

      const now = new Date()
      let contactId
      if (!existing) {
        contactId = await knex().transaction(async trx => {
          const [created] = await trx('agora_contacts')
            .insert({ ...values, consent: false, status: 'new', created_by_id: userId, updated_by_id: userId, created_at: now, updated_at: now })
            .returning('id')
          const id = created.id || created
          await Contacts.logChange(trx, { contactId: id, userId, action: 'created' })
          return id
        })
        summary.added++
      } else {
        contactId = existing.id
        if (changed.length) {
          await knex().transaction(async trx => {
            const update = {}
            for (const f of changed) update[f] = values[f]
            await trx('agora_contacts').where({ id: contactId }).update({ ...update, updated_by_id: userId, updated_at: now })
            await Contacts.logChange(trx, { contactId, userId, action: 'updated', fields: changed })
          })
        }
      }

      if (needsPhoto) {
        const url = await storePhoto(file, contactId)
        await knex().transaction(async trx => {
          await trx('agora_contacts').where({ id: contactId }).update({ photo_url: url, updated_at: new Date() })
          await Contacts.logChange(trx, { contactId, userId, action: 'updated', fields: ['photo_url'] })
        })
        summary.photos++
      }

      if (existing) {
        if (changed.length || needsPhoto) summary.updated++
        else summary.unchanged++
      }
      log(`  ${!existing ? 'added' : changed.length || needsPhoto ? 'updated' : 'unchanged'}: ${values.name}${needsPhoto ? ' (with photo)' : ''}`)
    } catch (err) {
      const message = err instanceof Contacts.ContactError || /^(Photo|The CSV)/.test(err.message) ? err.message : `Could not import: ${err.message}`
      summary.problems.push({ line, name: row.name || '', message })
      log(`  line ${line} (${row.name || 'no name'}): ${message}`)
    }
  }
  return summary
}

function photoStillThere (url) {
  const key = diskUploads.keyFromUrl(url)
  if (!key) return true // an address elsewhere: keep it
  try {
    return fs.existsSync(diskUploads.filePath(key))
  } catch (err) {
    return false
  }
}
