/**
 * Agora: tasks. To-dos that live in a circle and can belong to a project
 * (a Hylo post of the type "project" in that circle).
 *
 * Who may do what:
 *   - every active member of the circle: see, add, move between columns, comment
 *   - an assignee, the person who made the task, or a steward of the circle
 *     (Administration or Manage Content, or an Agora admin): change, delete, restore
 *
 * A person who is not in the circle gets "not found", so the answer does not
 * show that the task exists. Notifications are not part of this file.
 */
const Admins = require('./admins')

const STATUSES = ['todo', 'doing', 'done']
const DONE_VISIBLE_DAYS = 14

class TaskError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

const knex = () => bookshelf.knex
const NOT_FOUND = () => new TaskError(404, 'This task does not exist.')

/* ----------------------------------------------------------------------- */
/* Who may do what                                                         */
/* ----------------------------------------------------------------------- */

async function isGroupMember (userId, groupId) {
  if (!userId || !groupId) return false
  const row = await knex()('group_memberships')
    .join('groups', 'groups.id', 'group_memberships.group_id')
    .where({ 'group_memberships.user_id': userId, 'group_memberships.group_id': groupId, 'group_memberships.active': true, 'groups.active': true })
    .first('group_memberships.id')
  return Boolean(row)
}

/** Circles (ids as strings) the person is an active member of. */
async function memberGroupIds (userId) {
  const rows = await knex()('group_memberships')
    .join('groups', 'groups.id', 'group_memberships.group_id')
    .where({ 'group_memberships.user_id': userId, 'group_memberships.active': true, 'groups.active': true })
    .pluck('group_memberships.group_id')
  return rows.map(String)
}

/** A steward of the circle: Administration or Manage Content there (Hylo's own check), or an Agora admin. */
async function isSteward (userId, groupId) {
  if (!userId || !groupId) return false
  if (await Admins.isAgoraAdmin(userId)) return true
  const { RESP_ADMINISTRATION, RESP_MANAGE_CONTENT } = Responsibility.constants
  if (await GroupMembership.hasResponsibility(userId, groupId, RESP_ADMINISTRATION)) return true
  return GroupMembership.hasResponsibility(userId, groupId, RESP_MANAGE_CONTENT)
}

/* ----------------------------------------------------------------------- */
/* Checking what someone typed                                             */
/* ----------------------------------------------------------------------- */

function cleanId (value, label) {
  if (value === undefined || value === null || value === '') return null
  if (!/^\d+$/.test(String(value))) throw new TaskError(400, `${label} is not valid.`)
  return String(value)
}

function cleanTitle (value) {
  const v = value == null ? '' : String(value).trim()
  if (!v) throw new TaskError(400, 'A title is needed.')
  if (v.length > 500) throw new TaskError(400, 'The title is too long (at most 500 characters).')
  return v
}

function cleanDescription (value) {
  const v = value == null ? '' : String(value).trim()
  if (v.length > 20000) throw new TaskError(400, 'The description is too long.')
  return v || null
}

function cleanStatus (value) {
  if (!STATUSES.includes(value)) throw new TaskError(400, 'That status does not exist.')
  return value
}

function cleanDueDate (value) {
  if (value === undefined || value === null || value === '') return null
  const v = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v)) || new Date(v).toISOString().slice(0, 10) !== v) {
    throw new TaskError(400, 'The due date is not valid.')
  }
  return v
}

function cleanPosition (value) {
  const n = Number(value)
  if (value === null || value === '' || !Number.isFinite(n)) throw new TaskError(400, 'The position is not valid.')
  return n
}

async function cleanAssignees (value, groupId) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new TaskError(400, 'The people for the task are not valid.')
  const ids = []
  for (const raw of value) {
    const id = cleanId(raw, 'A person')
    if (id && !ids.includes(id)) ids.push(id)
  }
  if (ids.length > 50) throw new TaskError(400, 'That is too many people on one task.')
  for (const id of ids) {
    if (!(await isGroupMember(id, groupId))) throw new TaskError(400, 'Everyone on a task must be a member of the circle.')
  }
  return ids
}

/** The id of an active project post in the circle, or a 400. Null clears it. */
async function cleanProject (value, groupId) {
  const id = cleanId(value, 'The project')
  if (!id) return null
  const row = await knex()('posts')
    .join('groups_posts', 'groups_posts.post_id', 'posts.id')
    .where({ 'posts.id': id, 'posts.type': 'project', 'posts.active': true, 'groups_posts.group_id': groupId })
    .first('posts.id')
  if (!row) throw new TaskError(400, 'That project is not in this circle.')
  return id
}

/* ----------------------------------------------------------------------- */
/* Reading                                                                 */
/* ----------------------------------------------------------------------- */

function baseQuery () {
  return knex()('agora_tasks as t')
    .join('groups as g', 'g.id', 't.group_id')
    .leftJoin('posts as p', 'p.id', 't.project_post_id')
    .leftJoin('users as cu', 'cu.id', 't.created_by_id')
    .whereNull('t.removed_at')
    .select(
      't.*',
      knex().raw("to_char(t.due_date, 'YYYY-MM-DD') as due_date_text"),
      'g.slug as group_slug', 'g.name as group_name',
      'p.name as project_name', 'cu.name as created_by_name',
      knex().raw('(select count(*) from agora_task_comments c where c.task_id = t.id and c.removed_at is null) as comment_count')
    )
}

function doneCutoff () {
  return new Date(Date.now() - DONE_VISIBLE_DAYS * 86400000)
}

/** Leaves out tasks done more than two weeks ago. */
function hideOldDone (query, includeDone) {
  if (includeDone) return query
  return query.where(w => w.whereNot('t.status', 'done').orWhere('t.completed_at', '>=', doneCutoff()))
}

function person (row) {
  return { id: Number(row.id), name: row.name, avatarUrl: row.avatar_url || null }
}

/** Turns rows into the task objects the page uses (assignees, canEdit, ...). */
async function present (rows, userId) {
  if (!rows.length) return []
  const ids = rows.map(r => r.id)
  const assigneeRows = await knex()('agora_task_assignees as a')
    .join('users as u', 'u.id', 'a.user_id')
    .whereIn('a.task_id', ids)
    .orderBy('a.created_at', 'asc').orderBy('u.id', 'asc')
    .select('a.task_id', 'u.id', 'u.name', 'u.avatar_url')
  const byTask = {}
  for (const a of assigneeRows) (byTask[a.task_id] = byTask[a.task_id] || []).push(person(a))

  const steward = {}
  const out = []
  for (const r of rows) {
    const assignees = byTask[r.id] || []
    const mine = assignees.some(a => String(a.id) === String(userId)) || String(r.created_by_id) === String(userId)
    let canEdit = mine
    if (!canEdit) {
      if (steward[r.group_id] === undefined) steward[r.group_id] = await isSteward(userId, r.group_id)
      canEdit = steward[r.group_id]
    }
    out.push({
      id: Number(r.id),
      groupId: Number(r.group_id),
      groupSlug: r.group_slug,
      groupName: r.group_name,
      projectId: r.project_post_id ? Number(r.project_post_id) : null,
      projectName: r.project_post_id ? (r.project_name || null) : null,
      title: r.title,
      description: r.description || '',
      status: r.status,
      position: Number(r.position),
      dueDate: r.due_date_text || null,
      assignees,
      createdBy: { id: r.created_by_id ? Number(r.created_by_id) : null, name: r.created_by_name || null },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || null,
      source: r.source_minutes_post_id || r.source_meeting_session_id
        ? {
            kind: 'minutes',
            minutesPostId: r.source_minutes_post_id ? Number(r.source_minutes_post_id) : null,
            meetingSessionId: r.source_meeting_session_id ? Number(r.source_meeting_session_id) : null
          }
        : null,
      commentCount: Number(r.comment_count),
      canEdit
    })
  }
  return out
}

/** The circle a project post is in, among those the person belongs to. */
async function groupOfProject (projectId, userId, preferredGroupId = null) {
  const id = cleanId(projectId, 'The project')
  const rows = await knex()('posts')
    .join('groups_posts', 'groups_posts.post_id', 'posts.id')
    .join('groups', 'groups.id', 'groups_posts.group_id')
    .where({ 'posts.id': id, 'posts.type': 'project', 'posts.active': true, 'groups.active': true })
    .pluck('groups_posts.group_id')
  const wanted = preferredGroupId ? rows.filter(g => String(g) === String(preferredGroupId)) : rows
  for (const g of wanted) {
    if (await isGroupMember(userId, g)) return String(g)
  }
  throw new TaskError(404, 'This project does not exist.')
}

/** Works out the circle (and project) a request is about, and checks the person is a member. */
async function resolveScope (userId, { groupId, projectId }) {
  const gid = cleanId(groupId, 'The circle')
  const pid = cleanId(projectId, 'The project')
  if (!gid && !pid) throw new TaskError(400, 'A circle or a project is needed.')
  let group = gid
  if (pid) group = await groupOfProject(pid, userId, gid)
  if (!(await isGroupMember(userId, group))) throw new TaskError(403, 'Tasks are for members of the circle.')
  return { groupId: group, projectId: pid }
}

async function list (userId, { groupId, projectId, mine, includeDone } = {}) {
  const scope = await resolveScope(userId, { groupId, projectId })
  const query = baseQuery().where('t.group_id', scope.groupId)
  if (scope.projectId) query.where('t.project_post_id', scope.projectId)
  if (mine) query.whereExists(knex().select(knex().raw('1')).from('agora_task_assignees as a').whereRaw('a.task_id = t.id').where('a.user_id', userId))
  hideOldDone(query, includeDone)
  query.orderBy('t.status', 'asc').orderBy('t.position', 'asc').orderBy('t.id', 'asc').limit(2000)
  return present(await query, userId)
}

/** My tasks across every circle I am in. */
async function mine (userId) {
  const groupIds = await memberGroupIds(userId)
  if (!groupIds.length) return []
  const query = baseQuery()
    .whereIn('t.group_id', groupIds)
    .whereExists(knex().select(knex().raw('1')).from('agora_task_assignees as a').whereRaw('a.task_id = t.id').where('a.user_id', userId))
  hideOldDone(query, false)
  query.orderBy('t.status', 'asc').orderBy('t.position', 'asc').orderBy('t.id', 'asc').limit(2000)
  return present(await query, userId)
}

async function meta (userId, { groupId, projectId } = {}) {
  const scope = await resolveScope(userId, { groupId, projectId })
  const group = await knex()('groups').where({ id: scope.groupId }).first('id', 'slug', 'name')
  let project = null
  if (scope.projectId) {
    const p = await knex()('posts').where({ id: scope.projectId }).first('id', 'name')
    project = { id: Number(p.id), name: p.name }
  }
  const members = await knex()('group_memberships as m')
    .join('users as u', 'u.id', 'm.user_id')
    .where({ 'm.group_id': scope.groupId, 'm.active': true, 'u.active': true })
    .orderByRaw('lower(u.name) asc')
    .select('u.id', 'u.name', 'u.avatar_url')
  const projects = await knex()('posts')
    .join('groups_posts', 'groups_posts.post_id', 'posts.id')
    .where({ 'groups_posts.group_id': scope.groupId, 'posts.type': 'project', 'posts.active': true })
    .orderByRaw('lower(posts.name) asc')
    .select('posts.id', 'posts.name')
  return {
    group: { id: Number(group.id), slug: group.slug, name: group.name },
    project,
    members: members.map(person),
    projects: projects.map(p => ({ id: Number(p.id), name: p.name })),
    canManage: await isSteward(userId, scope.groupId)
  }
}

/** The task row for a person who may see it, or a 404 (also for a task in a circle they are not in). */
async function visibleTask (userId, taskId) {
  if (!/^\d+$/.test(String(taskId))) throw NOT_FOUND()
  const row = await baseQuery().where('t.id', taskId).first()
  if (!row || !(await isGroupMember(userId, row.group_id))) throw NOT_FOUND()
  return row
}

async function presentOne (userId, taskId) {
  const row = await baseQuery().where('t.id', taskId).first()
  return (await present([row], userId))[0]
}

async function get (userId, taskId) {
  const row = await visibleTask(userId, taskId)
  const task = (await present([row], userId))[0]
  const comments = await knex()('agora_task_comments as c')
    .leftJoin('users as u', 'u.id', 'c.user_id')
    .where('c.task_id', taskId)
    .whereNull('c.removed_at')
    .orderBy('c.created_at', 'asc').orderBy('c.id', 'asc')
    .select('c.id', 'c.user_id', 'c.text', 'c.created_at', 'u.name', 'u.avatar_url')
  const steward = await isSteward(userId, row.group_id)
  return {
    task,
    comments: comments.map(c => ({
      id: Number(c.id),
      user: { id: c.user_id ? Number(c.user_id) : null, name: c.name || null, avatarUrl: c.avatar_url || null },
      text: c.text,
      createdAt: c.created_at,
      canDelete: steward || String(c.user_id) === String(userId)
    }))
  }
}

/* ----------------------------------------------------------------------- */
/* Changing                                                                */
/* ----------------------------------------------------------------------- */

async function endOfColumn (trx, groupId, status) {
  const row = await trx('agora_tasks').where({ group_id: groupId, status }).whereNull('removed_at').max('position as max').first()
  return row && row.max !== null && row.max !== undefined ? Number(row.max) + 1 : 1
}

async function setAssignees (trx, taskId, ids) {
  await trx('agora_task_assignees').where({ task_id: taskId }).whereNotIn('user_id', ids).del()
  const have = await trx('agora_task_assignees').where({ task_id: taskId }).pluck('user_id')
  const haveSet = new Set(have.map(String))
  const now = new Date()
  const fresh = ids.filter(id => !haveSet.has(String(id))).map(id => ({ task_id: taskId, user_id: id, created_at: now }))
  if (fresh.length) await trx('agora_task_assignees').insert(fresh)
}

async function create (userId, input = {}) {
  const scope = await resolveScope(userId, input)
  const title = cleanTitle(input.title)
  const description = cleanDescription(input.description)
  const status = input.status === undefined || input.status === null ? 'todo' : cleanStatus(input.status)
  const dueDate = cleanDueDate(input.dueDate)
  const assignees = await cleanAssignees(input.assigneeIds, scope.groupId)
  const projectId = await cleanProject(scope.projectId, scope.groupId)
  const now = new Date()
  const taskId = await knex().transaction(async trx => {
    const position = await endOfColumn(trx, scope.groupId, status)
    const [row] = await trx('agora_tasks').insert({
      group_id: scope.groupId,
      project_post_id: projectId,
      title,
      description,
      status,
      position,
      due_date: dueDate,
      created_by_id: userId,
      completed_at: status === 'done' ? now : null,
      created_at: now,
      updated_at: now
    }).returning('id')
    const id = row.id || row
    await setAssignees(trx, id, assignees)
    return id
  })
  return presentOne(userId, taskId)
}

async function assertCanEdit (userId, row) {
  const assignee = await knex()('agora_task_assignees').where({ task_id: row.id, user_id: userId }).first('task_id')
  if (assignee || String(row.created_by_id) === String(userId)) return
  if (await isSteward(userId, row.group_id)) return
  throw new TaskError(403, 'Only the people on this task, the person who made it and stewards can change it.')
}

async function update (userId, taskId, input = {}) {
  const row = await visibleTask(userId, taskId)
  await assertCanEdit(userId, row)
  const changes = {}
  if (input.title !== undefined) changes.title = cleanTitle(input.title)
  if (input.description !== undefined) changes.description = cleanDescription(input.description)
  if (input.dueDate !== undefined) changes.due_date = cleanDueDate(input.dueDate)
  if (input.status !== undefined) {
    changes.status = cleanStatus(input.status)
    if (changes.status === 'done' && row.status !== 'done') changes.completed_at = new Date()
    if (changes.status !== 'done') changes.completed_at = null
    if (changes.status !== row.status && input.position === undefined) {
      changes.position = await endOfColumn(knex(), row.group_id, changes.status)
    }
  }
  if (input.position !== undefined) changes.position = cleanPosition(input.position)
  if (input.projectId !== undefined) changes.project_post_id = await cleanProject(input.projectId, row.group_id)
  const assignees = input.assigneeIds !== undefined ? await cleanAssignees(input.assigneeIds, row.group_id) : null
  await knex().transaction(async trx => {
    await trx('agora_tasks').where({ id: row.id }).update({ ...changes, updated_at: new Date() })
    if (assignees) await setAssignees(trx, row.id, assignees)
  })
  return presentOne(userId, row.id)
}

/** Any member may move a task: a new status and a place in that column. */
async function move (userId, taskId, input = {}) {
  const row = await visibleTask(userId, taskId)
  const status = cleanStatus(input.status)
  const position = cleanPosition(input.position)
  const changes = { status, position, updated_at: new Date() }
  if (status === 'done' && row.status !== 'done') changes.completed_at = new Date()
  if (status !== 'done') changes.completed_at = null
  await knex()('agora_tasks').where({ id: row.id }).update(changes)
  return presentOne(userId, row.id)
}

async function remove (userId, taskId) {
  const row = await visibleTask(userId, taskId)
  await assertCanEdit(userId, row)
  await knex()('agora_tasks').where({ id: row.id }).update({ removed_at: new Date(), removed_by_id: userId, updated_at: new Date() })
}

async function restore (userId, taskId) {
  if (!/^\d+$/.test(String(taskId))) throw NOT_FOUND()
  const row = await knex()('agora_tasks').where({ id: taskId }).first()
  if (!row || !(await isGroupMember(userId, row.group_id))) throw NOT_FOUND()
  await assertCanEdit(userId, row)
  await knex()('agora_tasks').where({ id: row.id }).update({ removed_at: null, removed_by_id: null, updated_at: new Date() })
  return presentOne(userId, row.id)
}

async function addComment (userId, taskId, input = {}) {
  const row = await visibleTask(userId, taskId)
  const text = input.text == null ? '' : String(input.text).trim()
  if (!text) throw new TaskError(400, 'A comment cannot be empty.')
  if (text.length > 10000) throw new TaskError(400, 'The comment is too long.')
  const [inserted] = await knex()('agora_task_comments')
    .insert({ task_id: row.id, user_id: userId, text, created_at: new Date() })
    .returning('id')
  const id = inserted.id || inserted
  const c = await knex()('agora_task_comments as c')
    .leftJoin('users as u', 'u.id', 'c.user_id')
    .where('c.id', id)
    .first('c.id', 'c.user_id', 'c.text', 'c.created_at', 'u.name', 'u.avatar_url')
  return {
    id: Number(c.id),
    user: { id: Number(c.user_id), name: c.name, avatarUrl: c.avatar_url || null },
    text: c.text,
    createdAt: c.created_at,
    canDelete: true
  }
}

/** The writer of a comment, or a steward of the circle, may delete it. */
async function removeComment (userId, commentId) {
  if (!/^\d+$/.test(String(commentId))) throw new TaskError(404, 'This comment does not exist.')
  const c = await knex()('agora_task_comments as c')
    .join('agora_tasks as t', 't.id', 'c.task_id')
    .where('c.id', commentId).whereNull('c.removed_at').whereNull('t.removed_at')
    .first('c.id', 'c.user_id', 't.group_id')
  if (!c || !(await isGroupMember(userId, c.group_id))) throw new TaskError(404, 'This comment does not exist.')
  if (String(c.user_id) !== String(userId) && !(await isSteward(userId, c.group_id))) {
    throw new TaskError(403, 'Only the writer or a steward can delete this comment.')
  }
  await knex()('agora_task_comments').where({ id: c.id }).update({ removed_at: new Date() })
}

module.exports = {
  STATUSES,
  TaskError,
  isGroupMember,
  isSteward,
  list,
  mine,
  meta,
  get,
  create,
  update,
  move,
  remove,
  restore,
  addComment,
  removeComment
}
