/**
 * Agora: one shared list of the people and organisations 7BP works with
 * outside Agora: partners, press, funders and interested people.
 *
 * Every Agora member can read, add, change and delete contacts. Every change
 * is written to agora_contact_changes: who, when and which fields, never the
 * contents. Deleting a contact removes the person and their notes completely.
 *
 * "Agora member" means a person who belongs to at least one circle. Someone
 * who only made an account sees nothing.
 *
 * A contact of the kind "team" can also hold a short profile (country, what
 * they do and can do, why they are here, skills, a photo), which the person
 * can claim later through a claim link, see lib/agora/claims.js.
 */

const KINDS = ['team', 'partner', 'press', 'funder', 'interested', 'other']
const STATUSES = ['new', 'in_touch', 'active', 'paused']
const FIELDS = [
  'name', 'organisation', 'kind', 'email', 'phone', 'website', 'status', 'circle_id',
  'source', 'consent', 'follow_up_on', 'follow_up_what', 'follow_up_owner_id',
  'country', 'offers', 'why_here', 'skills'
]
// Shown, but never changed through the page: the photo comes from the import
// script, the claim fields from lib/agora/claims.js. The claim link's hash is never shown.
const SHOWN_ONLY = ['photo_url', 'claimed_user_id', 'claimed_at', 'claim_token_created_at']

class ContactError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

const knex = () => bookshelf.knex

/** Today's date where 7BP is, as YYYY-MM-DD. AGORA_TIME_ZONE can change the place. */
function today () {
  return new Date().toLocaleDateString('sv-SE', { timeZone: process.env.AGORA_TIME_ZONE || 'Europe/Amsterdam' })
}

async function isMember (userId) {
  if (!userId) return false
  const row = await knex()('group_memberships')
    .join('groups', 'groups.id', 'group_memberships.group_id')
    .where({ 'group_memberships.user_id': userId, 'group_memberships.active': true, 'groups.active': true })
    .first('group_memberships.id')
  return Boolean(row)
}

function text (value, label, max, { required = false } = {}) {
  const v = value == null ? '' : String(value).trim()
  if (required && !v) throw new ContactError(400, `${label} is needed.`)
  if (v.length > max) throw new ContactError(400, `${label} is too long (at most ${max} characters).`)
  return v || null
}

function id (value, label) {
  if (value === undefined || value === null || value === '') return null
  if (!/^\d+$/.test(String(value))) throw new ContactError(400, `${label} is not valid.`)
  return String(value)
}

/** Skills as one line, separated by commas: "Facilitation, Writing". Each at most 39 characters, as in Hylo. */
function cleanSkills (value) {
  const raw = Array.isArray(value) ? value.join(',') : (value == null ? '' : String(value))
  const skills = []
  for (const part of raw.split(',')) {
    const skill = part.replace(/\s+/g, ' ').trim()
    if (!skill) continue
    if (skill.length > 39) throw new ContactError(400, `The skill "${skill.slice(0, 39)}..." is too long (at most 39 characters).`)
    if (!skills.some(s => s.toLowerCase() === skill.toLowerCase())) skills.push(skill)
  }
  if (skills.length > 30) throw new ContactError(400, 'That is too many skills (at most 30).')
  return skills.length ? skills.join(', ') : null
}

/** Checks and tidies what someone typed. Unknown fields are ignored. */
async function clean (input = {}) {
  const c = {}
  c.name = text(input.name, 'A name', 255, { required: true })
  c.organisation = text(input.organisation, 'The organisation', 255)
  c.kind = input.kind || 'partner'
  if (!KINDS.includes(c.kind)) throw new ContactError(400, 'That kind of contact does not exist.')
  c.status = input.status || 'new'
  if (!STATUSES.includes(c.status)) throw new ContactError(400, 'That status does not exist.')

  c.email = text(input.email, 'The email address', 255)
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new ContactError(400, 'The email address does not look right.')
  c.phone = text(input.phone, 'The phone number', 50)
  c.website = text(input.website, 'The website', 255)
  if (c.website && !/^https?:\/\//i.test(c.website)) c.website = `https://${c.website}`

  c.source = text(input.source, 'Where the details came from', 2000)
  c.consent = input.consent === true || input.consent === 'true'

  c.circle_id = id(input.circle_id, 'The circle')
  if (c.circle_id) {
    const circle = await knex()('groups').where({ id: c.circle_id, active: true }).first('id')
    if (!circle) throw new ContactError(400, 'That circle does not exist.')
  }

  c.follow_up_on = input.follow_up_on ? String(input.follow_up_on) : null
  if (c.follow_up_on && (!/^\d{4}-\d{2}-\d{2}$/.test(c.follow_up_on) || isNaN(new Date(c.follow_up_on)))) {
    throw new ContactError(400, 'The follow-up date is not valid.')
  }
  c.follow_up_what = text(input.follow_up_what, 'The next step', 1000)
  c.country = text(input.country, 'The country', 255)
  c.offers = text(input.offers, 'What they do and can do', 5000)
  c.why_here = text(input.why_here, 'Why they are here', 5000)
  c.skills = cleanSkills(input.skills)

  c.follow_up_owner_id = id(input.follow_up_owner_id, 'The person for the next step')
  if (c.follow_up_owner_id && !(await isMember(c.follow_up_owner_id))) {
    throw new ContactError(400, 'The person for the next step is not an Agora member.')
  }
  return c
}

function logChange (trx, { contactId, userId, action, fields = null }) {
  return trx('agora_contact_changes').insert({
    contact_id: contactId,
    user_id: userId,
    action,
    fields: fields ? JSON.stringify(fields) : null,
    created_at: new Date()
  })
}

function baseQuery () {
  return knex()('agora_contacts as c')
    .leftJoin('groups as g', 'g.id', 'c.circle_id')
    .leftJoin('users as o', 'o.id', 'c.follow_up_owner_id')
    .leftJoin('users as cu', 'cu.id', 'c.claimed_user_id')
    .leftJoin('users as pu', 'pu.id', 'c.proposed_user_id')
    .select('c.*', knex().raw('(select max(n.created_at) from agora_contact_notes n where n.contact_id = c.id) as last_contact_at'), 'g.name as circle_name', 'o.name as follow_up_owner_name', 'cu.name as claimed_user_name', 'pu.name as proposed_user_name')
}

function present (row) {
  if (!row) return null
  const out = {}
  for (const f of ['id', ...FIELDS, ...SHOWN_ONLY, 'circle_name', 'follow_up_owner_name', 'claimed_user_name', 'proposed_user_id', 'proposed_at', 'proposed_user_name', 'created_at', 'updated_at', 'last_contact_at']) out[f] = row[f]
  out.id = String(row.id)
  if (out.last_contact_at === undefined) out.last_contact_at = null
  if (out.claimed_user_id) out.claimed_user_id = String(out.claimed_user_id)
  if (out.proposed_user_id) out.proposed_user_id = String(out.proposed_user_id)
  // Whether a claim link is out; the link itself cannot be shown again
  out.has_claim_link = Boolean(row.claim_token_hash)
  if (out.circle_id) out.circle_id = String(out.circle_id)
  if (out.follow_up_owner_id) out.follow_up_owner_id = String(out.follow_up_owner_id)
  if (row.follow_up_on instanceof Date) out.follow_up_on = row.follow_up_on.toISOString().slice(0, 10)
  else if (row.follow_up_on) out.follow_up_on = String(row.follow_up_on).slice(0, 10)
  return out
}

/** The list, with optional search (q) and filters. mine: only my follow-ups. */
async function list ({ q, kind, status, circleId, mine, userId } = {}) {
  const query = baseQuery()
  if (q && String(q).trim()) {
    const like = `%${String(q).trim().replace(/[%_\\]/g, m => '\\' + m)}%`
    query.where(w => w.whereRaw('c.name ilike ?', [like]).orWhereRaw('c.organisation ilike ?', [like]).orWhereRaw('c.email ilike ?', [like])
      .orWhereRaw('c.country ilike ?', [like]).orWhereRaw('c.skills ilike ?', [like]))
  }
  if (kind && KINDS.includes(kind)) query.where('c.kind', kind)
  if (status && STATUSES.includes(status)) query.where('c.status', status)
  if (circleId && /^\d+$/.test(String(circleId))) query.where('c.circle_id', circleId)
  if (mine) {
    query.where('c.follow_up_owner_id', userId).whereNotNull('c.follow_up_on')
      .orderBy('c.follow_up_on', 'asc')
  }
  query.orderByRaw('lower(c.name) asc').limit(2000)
  return (await query).map(present)
}

/** How many of my follow-ups are due today or earlier. */
async function dueCount (userId) {
  const row = await knex()('agora_contacts')
    .where('follow_up_owner_id', userId)
    .where('follow_up_on', '<=', today())
    .count('id as count')
    .first()
  return Number(row.count)
}

async function get (contactId) {
  if (!/^\d+$/.test(String(contactId))) return null
  const contact = present(await baseQuery().where('c.id', contactId).first())
  if (!contact) return null
  const notes = await knex()('agora_contact_notes as n')
    .leftJoin('users as u', 'u.id', 'n.author_id')
    .where('n.contact_id', contactId)
    .orderBy('n.created_at', 'desc')
    .select('n.id', 'n.body', 'n.created_at', 'u.name as author_name')
  const changes = await knex()('agora_contact_changes as h')
    .leftJoin('users as u', 'u.id', 'h.user_id')
    .where('h.contact_id', contactId)
    .orderBy('h.created_at', 'desc')
    .limit(20)
    .select('h.action', 'h.fields', 'h.created_at', 'u.name as user_name')
  return {
    ...contact,
    notes: notes.map(n => ({ ...n, id: String(n.id) })),
    changes
  }
}

async function create (userId, input) {
  const values = await clean(input)
  const now = new Date()
  return knex().transaction(async trx => {
    const [row] = await trx('agora_contacts')
      .insert({ ...values, created_by_id: userId, updated_by_id: userId, created_at: now, updated_at: now })
      .returning('id')
    const contactId = row.id || row
    await logChange(trx, { contactId, userId, action: 'created' })
    return String(contactId)
  })
}

async function update (userId, contactId, input) {
  const values = await clean(input)
  return knex().transaction(async trx => {
    const current = await trx('agora_contacts').where({ id: contactId }).forUpdate().first()
    if (!current) throw new ContactError(404, 'This contact does not exist.')
    const same = (a, b) => String(a == null ? '' : a instanceof Date ? a.toISOString().slice(0, 10) : a) === String(b == null ? '' : b)
    const changed = FIELDS.filter(f => !same(current[f], values[f]))
    if (changed.length === 0) return String(contactId)
    await trx('agora_contacts').where({ id: contactId }).update({ ...values, updated_by_id: userId, updated_at: new Date() })
    await logChange(trx, { contactId, userId, action: 'updated', fields: changed })
    return String(contactId)
  })
}

async function addNote (userId, contactId, body) {
  const note = text(body, 'The note', 5000, { required: true })
  return knex().transaction(async trx => {
    const exists = await trx('agora_contacts').where({ id: contactId }).first('id')
    if (!exists) throw new ContactError(404, 'This contact does not exist.')
    await trx('agora_contact_notes').insert({ contact_id: contactId, author_id: userId, body: note, created_at: new Date() })
    await trx('agora_contacts').where({ id: contactId }).update({ updated_by_id: userId, updated_at: new Date() })
    await logChange(trx, { contactId, userId, action: 'note' })
  })
}

/**
 * Removes the contact and their notes for good. The change log keeps only that it happened.
 * Its photo goes too, unless someone who claimed the profile uses it as their profile picture.
 */
async function remove (userId, contactId) {
  const photoUrl = await knex().transaction(async trx => {
    const current = await trx('agora_contacts').where({ id: contactId }).first('photo_url')
    const deleted = await trx('agora_contacts').where({ id: contactId }).del()
    if (!deleted) throw new ContactError(404, 'This contact does not exist.')
    await logChange(trx, { contactId, userId, action: 'deleted' })
    return current && current.photo_url
  })
  if (photoUrl) {
    const inUse = await knex()('users').where({ avatar_url: photoUrl }).first('id')
    if (!inUse) await require('./diskUploads').removeUrls([photoUrl])
  }
}

/** What the page needs for its menus: the circles and the members. */
async function meta () {
  const circles = await knex()('groups').where({ active: true }).orderByRaw('lower(name)').select('id', 'name')
  const members = await knex()('users')
    .whereIn('id', knex()('group_memberships')
      .join('groups', 'groups.id', 'group_memberships.group_id')
      .where({ 'group_memberships.active': true, 'groups.active': true })
      .select('group_memberships.user_id'))
    .where('active', true)
    .orderByRaw('lower(name)')
    .select('id', 'name')
  const ids = rows => rows.map(r => ({ id: String(r.id), name: r.name }))
  return { kinds: KINDS, statuses: STATUSES, circles: ids(circles), members: ids(members) }
}

module.exports = { KINDS, STATUSES, ContactError, today, isMember, list, dueCount, get, create, update, addNote, remove, meta, logChange, clean, cleanSkills }
