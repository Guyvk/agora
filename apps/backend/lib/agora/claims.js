import crypto from 'crypto'

/**
 * Agora: profiles people can claim later.
 *
 * Some people are in Agora's Contacts before they have an account, for
 * example the activists who filled in a sheet at the activist council. Their
 * contact (of the kind "team") holds a short profile. A steward makes a claim
 * link for it and gives it to that person. The person opens the link
 * (/claim/<secret>), makes an account with their own email address or logs
 * in, and confirms. Then the profile becomes part of their own profile in
 * Agora, and they join the main 7BP circle.
 *
 * Safety:
 *   - The link carries 32 random bytes. Agora keeps only their sha256 hash
 *     (agora_contacts.claim_token_hash), never the link itself, so the link
 *     is shown once, right after it is made.
 *   - Making a new link replaces the old one, which stops working at once.
 *     A link can be withdrawn. A profile that was claimed cannot get a new link.
 *   - A claim link is not tied to an email address, on purpose: the sheets
 *     had no email addresses, and the person signs up with their own. So the
 *     link itself is the permission, like a circle's join link. It counts as
 *     permission to make an account while sign-up is by invitation only
 *     (lib/agora/signup.js), and it is used up once the profile is claimed.
 *     It is never an invitation to a circle, so it does not change how email
 *     invitations work (they still only work for their own address).
 *   - Only stewards make claim links: Agora admins (AGORA_ADMINS) and the
 *     stewards (Administration) of the main circle.
 *
 * The main circle is the circle with the address AGORA_MAIN_GROUP_SLUG in
 * apps/backend/.env, "7bp" when that is not set. Without such a circle,
 * claiming still works; the person just joins no circle.
 */

const Contacts = require('./contacts')
const Admins = require('./admins')
const { ContactError } = Contacts

// 32 random bytes, written in base64url: always 43 letters, digits, "-" or "_".
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SKILL_MAX = 39

const knex = () => bookshelf.knex

function newSecret () {
  return crypto.randomBytes(32).toString('base64url')
}

function hashSecret (secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex')
}

function isSecret (value) {
  return typeof value === 'string' && SECRET_PATTERN.test(value)
}

function webUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

/** The address a person opens to claim their profile. */
function claimUrl (secret) {
  return webUrl(`/claim/${secret}`)
}

function mainGroupSlug () {
  return String(process.env.AGORA_MAIN_GROUP_SLUG || '7bp').trim()
}

/** The main 7BP circle, or null when there is none with that address. */
async function mainGroup () {
  const slug = mainGroupSlug()
  if (!slug) return null
  return Group.where({ slug, active: true }).fetch({ require: false })
}

/** Whether this person may make and withdraw claim links: an Agora admin, or a steward of the main circle. */
async function canManage (userId) {
  if (!userId) return false
  if (await Admins.isAgoraAdmin(userId)) return true
  const group = await mainGroup()
  if (!group) return false
  return GroupMembership.hasResponsibility(userId, group.id, Responsibility.constants.RESP_ADMINISTRATION)
}

/**
 * Makes a claim link for a contact, replacing an earlier one.
 * Returns { link }, with the secret in it. It is shown once and never stored.
 */
async function createLink ({ contactId, userId, now = new Date() }) {
  if (!/^\d+$/.test(String(contactId))) throw new ContactError(404, 'This contact does not exist.')
  const secret = newSecret()
  await knex().transaction(async trx => {
    const contact = await trx('agora_contacts').where({ id: contactId }).forUpdate().first('id', 'claimed_user_id')
    if (!contact) throw new ContactError(404, 'This contact does not exist.')
    if (contact.claimed_user_id) throw new ContactError(409, 'This profile has been claimed already.')
    await trx('agora_contacts').where({ id: contactId }).update({
      claim_token_hash: hashSecret(secret),
      claim_token_created_at: now,
      updated_by_id: userId,
      updated_at: now
    })
    await Contacts.logChange(trx, { contactId, userId, action: 'claim_link' })
  })
  return { link: claimUrl(secret) }
}

/** Withdraws the claim link of a contact: it stops working at once. */
async function withdrawLink ({ contactId, userId, now = new Date() }) {
  if (!/^\d+$/.test(String(contactId))) throw new ContactError(404, 'This contact does not exist.')
  await knex().transaction(async trx => {
    const contact = await trx('agora_contacts').where({ id: contactId }).forUpdate().first('id', 'claim_token_hash')
    if (!contact) throw new ContactError(404, 'This contact does not exist.')
    if (!contact.claim_token_hash) return
    await trx('agora_contacts').where({ id: contactId }).update({
      claim_token_hash: null,
      claim_token_created_at: null,
      updated_by_id: userId,
      updated_at: now
    })
    await Contacts.logChange(trx, { contactId, userId, action: 'claim_link_withdrawn' })
  })
}

/** The contact a claim link belongs to, if the link still works. */
async function findByToken (secret, trx = null) {
  if (!isSecret(secret)) return null
  const query = (trx || knex())('agora_contacts')
    .where({ claim_token_hash: hashSecret(secret) })
    .whereNull('claimed_user_id')
  if (trx) query.forUpdate()
  return (await query.first()) || null
}

/** True when this claim link works now. Used by sign-up (lib/agora/signup.js). */
async function isValidToken (secret) {
  return Boolean(await findByToken(secret))
}

/** What the claim page shows: the profile, and nothing else (no email, phone, notes or follow-ups). */
async function preview (secret) {
  const contact = await findByToken(secret)
  if (!contact) return null
  return {
    name: contact.name,
    country: contact.country || null,
    offers: contact.offers || null,
    whyHere: contact.why_here || null,
    skills: splitSkills(contact.skills),
    photoUrl: contact.photo_url || null
  }
}

function splitSkills (skills) {
  return String(skills || '').split(',').map(s => s.trim()).filter(s => s && s.length <= SKILL_MAX)
}

function isEmptyText (value) {
  return value == null || String(value).trim() === ''
}

/**
 * Adds skills to a person's profile as skills they have (Hylo's skills_users,
 * type 0), the way Hylo's addSkill does. Skills already there stay.
 */
async function addSkills (trx, userId, names) {
  for (const name of names) {
    let skill = await trx('skills').whereRaw('lower(name) = lower(?)', [name]).first('id')
    if (!skill) {
      await trx.raw('insert into skills (name) values (?) on conflict (name) do nothing', [name])
      skill = await trx('skills').where({ name }).first('id')
    }
    const has = await trx('skills_users').where({ skill_id: skill.id, user_id: userId, type: Skill.Type.HAS }).first('id')
    if (!has) await trx('skills_users').insert({ skill_id: skill.id, user_id: userId, type: Skill.Type.HAS })
  }
}

/**
 * The person who is logged in claims the profile behind a claim link.
 * Fills in only what their own profile does not have yet, so nothing they
 * wrote themselves is overwritten:
 *   name       (only when they have none)
 *   bio        from "what I do and can do"
 *   intention  from "why I am here"
 *   location   from the country
 *   picture    from the photo (when they still have the standard picture)
 *   skills     added to the skills they already have
 * Then the link is used up, the contact remembers who claimed it, the change
 * log says so, and the person joins the main circle.
 * Returns { contactId, userId, filled: [the fields that were filled in], joinedGroup }.
 */
async function claim ({ secret, userId, proposalContactId = null, now = new Date() }) {
  if (!userId) throw new ContactError(401, 'Log in first.')
  if (proposalContactId == null && !isSecret(secret)) throw new ContactError(404, 'This claim link does not work.')
  const user = await User.find(userId)
  if (!user || !user.get('active')) throw new ContactError(403, 'Your account is not active.')

  const result = await knex().transaction(async trx => {
    let contact
    if (proposalContactId != null) {
      // Without a link: only the profile proposed to this person (by a steward, or guessed from names)
      const proposed = await proposalFor(userId, trx)
      if (!proposed || String(proposed.id) !== String(proposalContactId)) throw new ContactError(404, 'There is no profile proposed to you.')
      contact = await trx('agora_contacts').where({ id: proposed.id }).whereNull('claimed_user_id').forUpdate().first()
      if (!contact) throw new ContactError(404, 'There is no profile proposed to you.')
    } else {
      contact = await findByToken(secret, trx)
    }
    if (!contact) throw new ContactError(404, 'This claim link does not work.')
    const already = await trx('agora_contacts').where({ claimed_user_id: userId }).first('id')
    if (already) throw new ContactError(409, 'You have claimed a profile already.')

    const current = await trx('users').where({ id: userId }).first('name', 'bio', 'intention', 'location', 'avatar_url', 'email')
    const changes = {}
    if (isEmptyText(current.name) && !isEmptyText(contact.name)) changes.name = contact.name
    if (isEmptyText(current.bio) && !isEmptyText(contact.offers)) changes.bio = contact.offers
    if (isEmptyText(current.intention) && !isEmptyText(contact.why_here)) changes.intention = contact.why_here
    if (isEmptyText(current.location) && !isEmptyText(contact.country)) changes.location = contact.country
    const standardPicture = isEmptyText(current.avatar_url) || current.avatar_url === User.gravatar(current.email)
    if (standardPicture && !isEmptyText(contact.photo_url)) changes.avatar_url = contact.photo_url
    if (Object.keys(changes).length) await trx('users').where({ id: userId }).update({ ...changes, updated_at: now })

    const skills = splitSkills(contact.skills)
    if (skills.length) await addSkills(trx, userId, skills)

    await trx('agora_contacts').where({ id: contact.id }).update({
      claimed_user_id: userId,
      claimed_at: now,
      claim_token_hash: null,
      claim_token_created_at: null,
      proposed_user_id: null,
      proposed_at: null,
      updated_by_id: userId,
      updated_at: now
    })
    await Contacts.logChange(trx, { contactId: contact.id, userId, action: proposalContactId != null ? 'claimed_by_proposal' : 'claimed' })
    const filled = Object.keys(changes)
    if (skills.length) filled.push('skills')
    return { contactId: String(contact.id), filled }
  })

  // The main circle, the same way someone joins it through an invitation
  let joinedGroup = null
  const group = await mainGroup()
  if (group) {
    const membership = await GroupMembership.forPair(userId, group.id).fetch({ require: false })
    if (!membership || !membership.get('active')) {
      await user.joinGroup(group)
    }
    joinedGroup = { slug: group.get('slug'), name: group.get('name') }
  }
  return { ...result, userId: String(userId), joinedGroup }
}

/**
 * The person who claimed a profile deletes what the sheet left in Contacts:
 * country, what they do, why they are here, skills and the photo. Their name
 * stays (the contact is still their line in the list), and so does what was
 * copied into their own profile when they claimed it: that is theirs now and
 * they change it in their profile settings. Only the claimer can do this.
 * Returns { contactId, cleared: true }.
 */
async function removeSheetData ({ userId, now = new Date() }) {
  if (!userId) throw new ContactError(401, 'Log in first.')
  return knex().transaction(async trx => {
    const contact = await trx('agora_contacts').where({ claimed_user_id: userId }).forUpdate().first('id')
    if (!contact) throw new ContactError(404, 'There is no claimed profile for you.')
    await trx('agora_contacts').where({ id: contact.id }).update({
      country: null,
      offers: null,
      why_here: null,
      skills: null,
      photo_url: null,
      updated_by_id: userId,
      updated_at: now
    })
    await Contacts.logChange(trx, { contactId: contact.id, userId, action: 'sheet_data_removed' })
    return { contactId: String(contact.id), cleared: true }
  })
}

// ---------------------------------------------------------------------------
// Proposing a profile to a member
//
// The sheets have no email addresses, so a match is never certain. A profile
// can be proposed to a member in two ways, and the member always confirms on
// the claim page:
//   1. a steward picks the member (agora_contacts.proposed_user_id);
//   2. Agora guesses from the names (see guessProposal). A guess can
//      occasionally be wrong, for example for two members with the same name.
//      Only members of the main circle ever see one, and only their own.
// A steward's proposal wins over a guess. "This isn't me" is remembered per
// member and profile (agora_claim_dismissals), so it is never proposed again.
// ---------------------------------------------------------------------------

/** Lower case, no accents, no notes in brackets, only letters, digits and single spaces. */
function normalizeName (name) {
  return String(name || '')
    .replace(/\([^)]*\)?/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function firstWord (name) {
  return normalizeName(name).split(' ')[0] || ''
}

/**
 * Guesses which profile belongs to a member from the names alone.
 * contacts: all unclaimed team contacts [{ id, name }]; available: the ones
 * that may be proposed to this member (not dismissed by them, not proposed to
 * someone else); members: main circle members [{ id, name }].
 * A full name that matches wins, when it is unique both ways. Otherwise a
 * first word counts only when exactly one profile and exactly one member
 * have that first word. Returns the contact id or null.
 */
function guessProposal ({ user, contacts, available = contacts, members }) {
  const mine = normalizeName(user.name)
  if (!mine) return null
  const availableIds = new Set(available.map(c => String(c.id)))
  const count = (list, test) => list.filter(test).length

  const full = contacts.filter(c => normalizeName(c.name) === mine)
  if (full.length === 1 && count(members, m => normalizeName(m.name) === mine) === 1) {
    return availableIds.has(String(full[0].id)) ? String(full[0].id) : null
  }

  const word = firstWord(user.name)
  if (word.length < 2) return null
  const byWord = contacts.filter(c => firstWord(c.name) === word)
  if (byWord.length !== 1) return null
  if (count(members, m => firstWord(m.name) === word) !== 1) return null
  return availableIds.has(String(byWord[0].id)) ? String(byWord[0].id) : null
}

/** Active members of the main circle: [{ id, name }]. Empty without a main circle. */
async function mainMembers (db = knex()) {
  const group = await mainGroup()
  if (!group) return []
  return db('group_memberships as gm')
    .join('users as u', 'u.id', 'gm.user_id')
    .where({ 'gm.group_id': group.id, 'gm.active': true, 'u.active': true })
    .select('u.id', 'u.name')
}

/**
 * The unclaimed profile proposed to this person: a steward's proposal first,
 * else a guess from the names. Returns the contact row or null.
 * Only for members of the main circle who have not claimed a profile yet.
 */
async function proposalFor (userId, db = knex()) {
  if (!userId) return null
  const user = await db('users').where({ id: userId, active: true }).first('id', 'name')
  if (!user) return null
  if (await db('agora_contacts').where({ claimed_user_id: userId }).first('id')) return null
  const members = await mainMembers(db)
  if (!members.some(m => String(m.id) === String(userId))) return null

  const dismissed = new Set((await db('agora_claim_dismissals').where({ user_id: userId }).pluck('contact_id')).map(String))
  const chosen = await db('agora_contacts')
    .where({ kind: 'team', proposed_user_id: userId }).whereNull('claimed_user_id')
    .orderBy('proposed_at', 'desc').first()
  if (chosen && !dismissed.has(String(chosen.id))) return chosen

  const contacts = await db('agora_contacts').where({ kind: 'team' }).whereNull('claimed_user_id').select('id', 'name', 'proposed_user_id')
  const available = contacts.filter(c => !dismissed.has(String(c.id)) && (c.proposed_user_id == null || String(c.proposed_user_id) === String(userId)))
  const id = guessProposal({ user, contacts, available, members })
  if (!id) return null
  return db('agora_contacts').where({ id }).first()
}

/** What the logged-in member is shown: { contactId, profile }, or null. */
async function myProposal (userId) {
  const contact = await proposalFor(userId)
  if (!contact) return null
  return {
    contactId: String(contact.id),
    profile: {
      name: contact.name,
      country: contact.country || null,
      offers: contact.offers || null,
      whyHere: contact.why_here || null,
      skills: splitSkills(contact.skills),
      photoUrl: contact.photo_url || null
    }
  }
}

/** The member says "This isn't me": remembered, and a steward's proposal is cleared. */
async function dismissProposal ({ userId, contactId, now = new Date() }) {
  if (!userId) throw new ContactError(401, 'Log in first.')
  return knex().transaction(async trx => {
    const proposed = await proposalFor(userId, trx)
    if (!proposed || String(proposed.id) !== String(contactId)) throw new ContactError(404, 'There is no profile proposed to you.')
    await trx.raw('insert into agora_claim_dismissals (user_id, contact_id, created_at) values (?, ?, ?) on conflict do nothing', [userId, proposed.id, now])
    if (proposed.proposed_user_id != null && String(proposed.proposed_user_id) === String(userId)) {
      await trx('agora_contacts').where({ id: proposed.id }).update({ proposed_user_id: null, proposed_at: null, updated_at: now })
    }
    await Contacts.logChange(trx, { contactId: proposed.id, userId, action: 'proposal_declined' })
    return { ok: true }
  })
}

/** A steward proposes an unclaimed team profile to a member of the main circle. */
async function propose ({ contactId, memberId, userId, now = new Date() }) {
  if (!/^\d+$/.test(String(contactId))) throw new ContactError(404, 'This contact does not exist.')
  if (!/^\d+$/.test(String(memberId))) throw new ContactError(400, 'Pick a member.')
  const members = await mainMembers()
  if (!members.some(m => String(m.id) === String(memberId))) throw new ContactError(400, 'That person is not a member of the main circle.')
  await knex().transaction(async trx => {
    const contact = await trx('agora_contacts').where({ id: contactId }).forUpdate().first('id', 'kind', 'claimed_user_id')
    if (!contact) throw new ContactError(404, 'This contact does not exist.')
    if (contact.claimed_user_id) throw new ContactError(409, 'This profile has been claimed already.')
    if (contact.kind !== 'team') throw new ContactError(400, 'Only team profiles can be proposed.')
    await trx('agora_contacts').where({ id: contactId }).update({
      proposed_user_id: memberId, proposed_at: now, updated_by_id: userId, updated_at: now
    })
    // A new proposal is a fresh start for that member
    await trx('agora_claim_dismissals').where({ user_id: memberId, contact_id: contactId }).del()
    await Contacts.logChange(trx, { contactId, userId, action: 'proposed' })
  })
}

/** A steward takes the proposal back. */
async function clearProposal ({ contactId, userId, now = new Date() }) {
  if (!/^\d+$/.test(String(contactId))) throw new ContactError(404, 'This contact does not exist.')
  await knex().transaction(async trx => {
    const contact = await trx('agora_contacts').where({ id: contactId }).forUpdate().first('id', 'proposed_user_id')
    if (!contact) throw new ContactError(404, 'This contact does not exist.')
    if (!contact.proposed_user_id) return
    await trx('agora_contacts').where({ id: contactId }).update({ proposed_user_id: null, proposed_at: null, updated_by_id: userId, updated_at: now })
    await Contacts.logChange(trx, { contactId, userId, action: 'proposal_cleared' })
  })
}

/**
 * For the steward's picker: main circle members matching the search, with
 * the ones whose first name is the contact's first word first (suggestions only).
 * Returns { suggested: [{ id, name }], members: [{ id, name }] }.
 */
async function memberChoices ({ contactId, q = '' }) {
  if (!/^\d+$/.test(String(contactId))) throw new ContactError(404, 'This contact does not exist.')
  const contact = await knex()('agora_contacts').where({ id: contactId }).first('name')
  if (!contact) throw new ContactError(404, 'This contact does not exist.')
  const word = firstWord(contact.name)
  const needle = normalizeName(q)
  const all = (await mainMembers())
    .filter(m => m.name)
    .map(m => ({ id: String(m.id), name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const suggested = word ? all.filter(m => firstWord(m.name) === word) : []
  const taken = new Set(suggested.map(m => m.id))
  const members = all.filter(m => !taken.has(m.id) && (!needle || normalizeName(m.name).includes(needle))).slice(0, 30)
  return { suggested, members }
}

module.exports = {
  normalizeName,
  guessProposal,
  proposalFor,
  myProposal,
  dismissProposal,
  propose,
  clearProposal,
  memberChoices,
  removeSheetData,
  SECRET_PATTERN,
  hashSecret,
  isSecret,
  claimUrl,
  mainGroupSlug,
  mainGroup,
  canManage,
  createLink,
  withdrawLink,
  findByToken,
  isValidToken,
  preview,
  claim
}
