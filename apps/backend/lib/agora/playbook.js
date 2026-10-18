/**
 * Agora: the playbook page of a group. A playbook is a list of chapters, for
 * example onboarding, governance, communications, fundraising, events and
 * tech. Each chapter has an owner (a member of the group), a status, a short
 * text, a link (a Google Doc or a post) and the date it was last changed.
 *
 * Who may do what, checked here on the server for every request:
 * - members of the group read the playbook
 * - stewards of the group (people with the Administration responsibility)
 *   read it too, and add, change and remove chapters. For a space this
 *   includes the stewards of its parent group, as everywhere in Hylo, even
 *   when they did not join the space itself
 * - anyone else gets nothing, not even whether chapters exist
 *
 * The web page talks to this through GraphQL, see api/graphql/agora/playbook.js.
 */

const STATUSES = ['not_started', 'draft', 'in_review', 'agreed']
const MAX_CHAPTERS = 200

class PlaybookError extends Error {
  constructor (message) {
    super(message)
    this.name = 'PlaybookError'
  }
}

const knex = () => bookshelf.knex

function isId (value) {
  return value !== undefined && value !== null && /^\d+$/.test(String(value))
}

/** The group by id or by slug, if it exists and is active. */
async function findGroup ({ groupId, groupSlug }) {
  if (isId(groupId)) return knex()('groups').where({ id: groupId, active: true }).first('id', 'slug', 'name')
  if (groupSlug) return knex()('groups').where({ slug: String(groupSlug), active: true }).first('id', 'slug', 'name')
  return null
}

/** Members read, and so do stewards (who may be stewards of a space's parent without joining the space). */
async function canRead (userId, groupId) {
  if (!userId || !groupId) return false
  if (await GroupMembership.hasActiveMembership(userId, groupId)) return true
  return canEdit(userId, groupId)
}

async function canEdit (userId, groupId) {
  if (!userId || !groupId) return false
  return GroupMembership.hasResponsibility(userId, groupId, Responsibility.constants.RESP_ADMINISTRATION)
}

async function mustEdit (userId, groupId) {
  if (!(await canEdit(userId, groupId))) throw new PlaybookError('Only stewards of this group can change the playbook.')
}

function text (value, label, max, { required = false } = {}) {
  const v = value == null ? '' : String(value).trim()
  if (required && !v) throw new PlaybookError(`${label} is needed.`)
  if (v.length > max) throw new PlaybookError(`${label} is too long (at most ${max} characters).`)
  return v || null
}

/** A link must be a web address (http or https). "docs.google.com/..." becomes "https://docs.google.com/...". */
function cleanLink (value) {
  let v = text(value, 'The link', 1000)
  if (!v) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`
  let url
  try {
    url = new URL(v)
  } catch (e) {
    throw new PlaybookError('The link is not a web address.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new PlaybookError('The link must be a web address that starts with https://')
  }
  // The tidied address can be longer than what was typed (spaces become %20).
  if (url.href.length > 1000) throw new PlaybookError('The link is too long (at most 1000 characters).')
  return url.href
}

/** Checks and tidies what a steward typed. Fields that are left out keep their value. */
async function clean (groupId, input = {}, current = null) {
  const has = name => Object.prototype.hasOwnProperty.call(input, name) && input[name] !== undefined
  const c = {}

  if (has('title') || !current) c.title = text(input.title, 'A title', 200, { required: true })

  // A status of null or "" counts as left out: an existing chapter keeps its status, a new one starts as not_started.
  if ((input.status != null && input.status !== '') || !current) {
    c.status = input.status || 'not_started'
    if (!STATUSES.includes(c.status)) throw new PlaybookError('That status does not exist.')
  }

  if (has('summary')) c.summary = text(input.summary, 'The short text', 2000)
  if (has('link')) c.link = cleanLink(input.link)

  if (has('ownerId')) {
    const ownerId = input.ownerId === '' || input.ownerId === null ? null : input.ownerId
    if (ownerId !== null && !isId(ownerId)) throw new PlaybookError('The owner is not valid.')
    if (ownerId !== null && !(await GroupMembership.hasActiveMembership(ownerId, groupId))) {
      throw new PlaybookError('The owner must be a member of this group.')
    }
    c.owner_id = ownerId
  }

  if (has('position') && input.position !== null && input.position !== '') {
    const position = Number(input.position)
    if (!Number.isInteger(position) || position < 0 || position > 9999) {
      throw new PlaybookError('The order must be a whole number from 0 to 9999.')
    }
    c.position = position
  }
  return c
}

function person (id, name) {
  return id ? { id: String(id), name: name || null } : null
}

function present (row) {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    position: row.position,
    title: row.title,
    status: row.status,
    summary: row.summary || null,
    link: row.link || null,
    owner: person(row.owner_id, row.owner_name),
    updatedBy: person(row.updated_by_id, row.updated_by_name),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  }
}

function chapterQuery () {
  return knex()('agora_playbook_chapters as c')
    .leftJoin('users as o', 'o.id', 'c.owner_id')
    .leftJoin('users as u', 'u.id', 'c.updated_by_id')
    .select('c.*', 'o.name as owner_name', 'u.name as updated_by_name')
}

async function getChapter (chapterId) {
  if (!isId(chapterId)) return null
  const row = await chapterQuery().where('c.id', chapterId).first()
  return row ? present(row) : null
}

/** The members of a group, for choosing an owner. */
async function members (groupId) {
  const rows = await knex()('users')
    .join('group_memberships as m', 'm.user_id', 'users.id')
    .where({ 'm.group_id': groupId, 'm.active': true, 'users.active': true })
    .orderByRaw('lower(users.name)')
    .select('users.id', 'users.name')
  return rows.map(r => ({ id: String(r.id), name: r.name }))
}

/**
 * The playbook of a group, for a member or steward. Returns null for anyone
 * else, so outsiders cannot tell whether the group has one. members is a
 * function, so GraphQL only looks the members up when the page asks for them.
 */
async function playbook (userId, { groupId, groupSlug }) {
  const group = await findGroup({ groupId, groupSlug })
  if (!group || !(await canRead(userId, group.id))) return null
  const editable = await canEdit(userId, group.id)
  const rows = await chapterQuery()
    .where('c.group_id', group.id)
    .orderBy('c.position', 'asc')
    .orderByRaw('lower(c.title) asc')
    .orderBy('c.id', 'asc')
  return {
    groupId: String(group.id),
    groupSlug: group.slug,
    groupName: group.name,
    canEdit: editable,
    statuses: STATUSES,
    chapters: rows.map(present),
    members: () => editable ? members(group.id) : []
  }
}

async function createChapter (userId, groupId, input) {
  const group = await findGroup({ groupId })
  if (!group) throw new PlaybookError('This group does not exist.')
  await mustEdit(userId, group.id)
  const values = await clean(group.id, input)
  const count = await knex()('agora_playbook_chapters').where({ group_id: group.id }).count('id as n').first()
  if (Number(count.n) >= MAX_CHAPTERS) throw new PlaybookError(`A playbook can have at most ${MAX_CHAPTERS} chapters.`)
  if (values.position === undefined) {
    const last = await knex()('agora_playbook_chapters').where({ group_id: group.id }).max('position as p').first()
    values.position = last && last.p !== null ? Math.min(Number(last.p) + 1, 9999) : 1
  }
  const chapter = await AgoraPlaybookChapter.forge({
    ...values,
    group_id: group.id,
    created_by_id: userId,
    updated_by_id: userId
  }).save()
  return getChapter(chapter.id)
}

async function findForChange (userId, chapterId) {
  const chapter = isId(chapterId) ? await AgoraPlaybookChapter.where({ id: chapterId }).fetch() : null
  // Someone who may not read the playbook learns nothing, not even that the chapter exists.
  if (!chapter || !(await canRead(userId, chapter.get('group_id')))) throw new PlaybookError('This chapter does not exist.')
  await mustEdit(userId, chapter.get('group_id'))
  return chapter
}

async function updateChapter (userId, chapterId, input) {
  const chapter = await findForChange(userId, chapterId)
  const values = await clean(chapter.get('group_id'), input, chapter)
  await chapter.save({ ...values, updated_by_id: userId }, { patch: true })
  return getChapter(chapter.id)
}

async function deleteChapter (userId, chapterId) {
  const chapter = await findForChange(userId, chapterId)
  await chapter.destroy()
  return true
}

module.exports = {
  STATUSES,
  PlaybookError,
  canRead,
  canEdit,
  playbook,
  getChapter,
  createChapter,
  updateChapter,
  deleteChapter
}
