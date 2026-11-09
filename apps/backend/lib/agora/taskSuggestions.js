/**
 * Agora: tasks suggested by meeting minutes.
 *
 * When minutes are written, every action point becomes a SUGGESTED task. Nothing lands on
 * anyone's list until one of these says yes:
 *   - the person the action point names,
 *   - the host of the meeting (meeting_sessions.started_by_id),
 *   - a steward of the circle (Administration or Manage Content, or an Agora admin).
 * The same three may say "not a task". A named person may also say "not mine", which only
 * takes them off the action point (the host and stewards can still decide about it).
 *
 * Names in the minutes are matched to members who were IN the meeting (minutesActions.js).
 * Guests are never matched. A name without a clear match gives an action point without a
 * person, to be filled in by the host or a steward. "Everyone" gives one suggestion per
 * member who was present.
 *
 * A person who is not in the circle gets "not found" for everything here.
 */
const Tasks = require('./tasks')
const TaskNotify = require('./taskNotify')
const { normalizeAction, matchNames, whoText } = require('./minutesActions')
const { findMainGroup } = require('./mainGroup')

const { TaskError } = Tasks
const knex = () => bookshelf.knex
const NOT_FOUND = () => new TaskError(404, 'This action point does not exist.')

/* ----------------------------------------------------------------------- */
/* Making suggestions                                                      */
/* ----------------------------------------------------------------------- */

/** Active members of the circle who joined the meeting, as { id, name }. */
async function presentMembers (sessionId, groupId) {
  const rows = await knex()('meeting_participants as mp')
    .join('users as u', 'u.id', 'mp.user_id')
    .join('group_memberships as gm', function () {
      this.on('gm.user_id', 'mp.user_id').andOn('gm.group_id', knex().raw('?', [groupId]))
    })
    .where({ 'mp.session_id': sessionId, 'gm.active': true, 'u.active': true })
    .orderBy('mp.joined_at', 'asc')
    .select('u.id', 'u.name')
  const seen = new Set()
  return rows.filter(r => !seen.has(String(r.id)) && seen.add(String(r.id))).map(r => ({ id: String(r.id), name: r.name }))
}

/**
 * The circle the suggestions of a post belong to when the post is in several circles: the 7BP
 * main circle if it is one of them, else the circle the post was made in first (the earliest
 * groups_posts row). One circle is used for the people who count, the projects, the picker
 * and who may decide.
 */
async function groupOfPost (postId) {
  const rows = await knex()('groups_posts').where({ post_id: postId }).orderBy('id', 'asc').pluck('group_id')
  if (!rows.length) return null
  if (rows.length > 1) {
    const main = await findMainGroup()
    if (main && rows.map(String).includes(String(main.id))) return String(main.id)
  }
  return String(rows[0])
}

/** The names of the guests of a meeting (they are never matched to members). */
async function guestNamesOf (sessionId) {
  if (!sessionId) return []
  return knex()('meeting_guests').where({ session_id: sessionId }).pluck('name')
}

/** The open projects of a circle, as { id, name } (for the assistant and for checking its answer). */
async function openProjects (groupId, limit = 60) {
  if (!groupId) return []
  const rows = await knex()('posts')
    .join('groups_posts', 'groups_posts.post_id', 'posts.id')
    .where({ 'groups_posts.group_id': groupId, 'posts.type': 'project', 'posts.active': true })
    .orderBy('posts.id', 'desc').limit(limit)
    .select('posts.id', 'posts.name')
  return rows.map(r => ({ id: String(r.id), name: r.name }))
}

/**
 * Turns the action points of a minutes post into suggestions. Does nothing when the post
 * already has suggestions. Never throws: a failure is logged, so the minutes are never held up.
 * `actions` are the assistant's actions (old or new shape) or parsed ones from a post.
 * @returns {Promise<{ created: Array<{ whoText, what, due, people: Array<{id, name}> }> }>}
 */
async function createFromMinutes ({ sessionId, minutesPostId, actions, title, date, apply = true, notify = true }) {
  try {
    const groupId = await groupOfPost(minutesPostId)
    if (!groupId) return { created: [] }
    if (apply) {
      const existing = await knex()('agora_task_suggestions').where({ minutes_post_id: minutesPostId }).first('id')
      if (existing) return { created: [] }
    }
    const members = await presentMembers(sessionId, groupId)
    const guestNames = await guestNamesOf(sessionId)
    const projectIds = new Set((await openProjects(groupId, 500)).map(p => p.id))
    const planned = []
    let actionIndex = -1
    for (const raw of Array.isArray(actions) ? actions : []) {
      const a = normalizeAction(raw)
      if (!a.what) continue
      actionIndex++
      const projectId = a.project && projectIds.has(a.project) ? a.project : null
      const matched = matchNames(a.who, members, guestNames)
      const text = whoText(a.who).slice(0, 500) || null
      if (matched.everyone) {
        for (const m of members) planned.push({ actionIndex, whoText: text, what: a.what, due: a.due || null, projectId, people: [m] })
      } else {
        planned.push({ actionIndex, whoText: text, what: a.what, due: a.due || null, projectId, people: matched.people })
      }
    }
    if (!apply) return { created: planned }

    const now = new Date()
    await knex().transaction(async trx => {
      for (const p of planned) {
        const [row] = await trx('agora_task_suggestions').insert({
          group_id: groupId,
          meeting_session_id: sessionId || null,
          minutes_post_id: minutesPostId,
          action_index: p.actionIndex,
          who_text: p.whoText,
          what: p.what,
          due_date: p.due,
          project_post_id: p.projectId,
          status: 'open',
          created_at: now,
          updated_at: now
        }).returning('id')
        const id = row.id || row
        if (p.people.length) {
          await trx('agora_task_suggestion_people').insert(p.people.map(m => ({ suggestion_id: id, user_id: m.id, status: 'suggested' })))
        }
      }
    })

    // Tell each named person once, in the background
    const byPerson = {}
    for (const p of planned) for (const m of p.people) (byPerson[m.id] = byPerson[m.id] || []).push(p.what)
    if (notify && Object.keys(byPerson).length) TaskNotify.suggested({ groupId, meeting: title || 'the meeting', date, byPerson })
    return { created: planned }
  } catch (err) {
    console.error(`Agora tasks: could not make suggestions from the minutes (post ${minutesPostId}): ${err && err.message}`)
    return { created: [], error: err }
  }
}

/* ----------------------------------------------------------------------- */
/* Reading                                                                 */
/* ----------------------------------------------------------------------- */

async function rows (where) {
  return knex()('agora_task_suggestions as s')
    .join('groups as g', 'g.id', 's.group_id')
    .leftJoin('posts as p', 'p.id', 's.project_post_id')
    .leftJoin('meeting_sessions as ms', 'ms.id', 's.meeting_session_id')
    .leftJoin('posts as ev', 'ev.id', 'ms.post_id')
    .modify(where)
    .select(
      's.*',
      knex().raw("to_char(s.due_date, 'YYYY-MM-DD') as due_date_text"),
      'g.slug as group_slug', 'g.name as group_name', 'p.name as project_name',
      'ms.started_by_id as host_id', 'ms.started_at as meeting_started_at', 'ev.name as meeting_title'
    )
    .orderBy('s.minutes_post_id', 'asc').orderBy('s.action_index', 'asc').orderBy('s.id', 'asc')
}

/** Who may decide about a row: a named person (not one who said "not mine"), the host, a steward. */
async function mayDecide (userId, row, peopleOf, stewardCache) {
  if (!(await Tasks.isGroupMember(userId, row.group_id))) return false
  if (peopleOf.some(p => String(p.id) === String(userId) && p.status !== 'declined')) return true
  if (row.host_id && String(row.host_id) === String(userId)) return true
  if (stewardCache[row.group_id] === undefined) stewardCache[row.group_id] = await Tasks.isSteward(userId, row.group_id)
  return stewardCache[row.group_id]
}

async function present (list, userId) {
  if (!list.length) return []
  const ids = list.map(r => r.id)
  const peopleRows = await knex()('agora_task_suggestion_people as sp')
    .join('users as u', 'u.id', 'sp.user_id')
    .whereIn('sp.suggestion_id', ids)
    .orderBy('u.id', 'asc')
    .select('sp.suggestion_id', 'sp.status', 'u.id', 'u.name', 'u.avatar_url')
  const byId = {}
  for (const p of peopleRows) (byId[p.suggestion_id] = byId[p.suggestion_id] || []).push({ id: Number(p.id), name: p.name, avatarUrl: p.avatar_url || null, status: p.status, me: String(p.id) === String(userId) })
  const taskIds = list.map(r => r.task_id).filter(Boolean)
  const tasks = taskIds.length ? await knex()('agora_tasks').whereIn('id', taskIds).select('id', 'status', 'removed_at') : []
  const taskById = {}
  for (const t of tasks) taskById[t.id] = t

  const steward = {}
  const out = []
  for (const r of list) {
    const people = byId[r.id] || []
    const task = r.task_id ? taskById[r.task_id] : null
    out.push({
      id: Number(r.id),
      groupId: Number(r.group_id),
      groupSlug: r.group_slug,
      groupName: r.group_name,
      meetingSessionId: r.meeting_session_id ? Number(r.meeting_session_id) : null,
      minutesPostId: Number(r.minutes_post_id),
      meeting: { title: r.meeting_title || null, date: r.meeting_started_at ? new Date(r.meeting_started_at).toISOString().slice(0, 10) : null },
      actionIndex: r.action_index,
      whoText: r.who_text || '',
      what: r.what,
      dueDate: r.due_date_text || null,
      projectId: r.project_post_id ? Number(r.project_post_id) : null,
      projectName: r.project_post_id ? (r.project_name || null) : null,
      status: r.status,
      taskId: r.task_id ? Number(r.task_id) : null,
      taskStatus: task && !task.removed_at ? task.status : null,
      people,
      canDecide: r.status === 'open' && await mayDecide(userId, r, people, steward)
    })
  }
  return out
}

/** The minutes post's circles the person is a member of, or null. */
async function visibleMinutes (userId, minutesPostId) {
  if (!/^\d+$/.test(String(minutesPostId || ''))) throw NOT_FOUND()
  const session = await knex()('meeting_sessions').where({ minutes_post_id: minutesPostId }).first('id', 'started_by_id')
  if (!session) return null
  const groupIds = await knex()('groups_posts').where({ post_id: minutesPostId }).pluck('group_id')
  const mine = new Set(await Tasks.memberGroupIds(userId))
  if (!groupIds.some(g => mine.has(String(g)))) throw NOT_FOUND()
  return session
}

/**
 * The action points of one minutes post. isMinutes is false for any other post, so the page
 * can tell without an error. canAcceptAll: the host or a steward.
 */
async function listForMinutes (userId, minutesPostId) {
  const session = await visibleMinutes(userId, minutesPostId)
  if (!session) return { isMinutes: false, suggestions: [], canAcceptAll: false }
  const suggestions = await present(await rows(q => q.where('s.minutes_post_id', minutesPostId)), userId)
  const groupId = suggestions.length ? suggestions[0].groupId : null
  const canAcceptAll = Boolean(groupId) && await Tasks.isGroupMember(userId, groupId) &&
    (String(session.started_by_id) === String(userId) || await Tasks.isSteward(userId, groupId))
  return { isMinutes: true, suggestions, canAcceptAll }
}

/** Open suggestions where I am a suggested person (not one who said "not mine"). */
async function mine (userId) {
  const groupIds = await Tasks.memberGroupIds(userId)
  if (!groupIds.length) return []
  const list = await rows(q => q
    .whereIn('s.group_id', groupIds)
    .where('s.status', 'open')
    .whereExists(knex().select(knex().raw('1')).from('agora_task_suggestion_people as sp')
      .whereRaw('sp.suggestion_id = s.id').where({ 'sp.user_id': userId, 'sp.status': 'suggested' })))
  list.sort((a, b) => new Date(b.meeting_started_at || 0) - new Date(a.meeting_started_at || 0) || a.id - b.id)
  return present(list, userId)
}

/* ----------------------------------------------------------------------- */
/* Deciding                                                                */
/* ----------------------------------------------------------------------- */

/** The row of a suggestion in a circle the person is in, or a 404. */
async function visibleRow (userId, id) {
  if (!/^\d+$/.test(String(id || ''))) throw NOT_FOUND()
  const row = (await rows(q => q.where('s.id', id)))[0]
  if (!row || !(await Tasks.isGroupMember(userId, row.group_id))) throw NOT_FOUND()
  return row
}

async function peopleOf (id) {
  return knex()('agora_task_suggestion_people').where({ suggestion_id: id }).select('user_id as id', 'status')
}

async function presentOne (userId, id) {
  return (await present(await rows(q => q.where('s.id', id)), userId))[0]
}

async function assertMayDecide (userId, row) {
  if (!(await mayDecide(userId, row, await peopleOf(row.id), {}))) {
    throw new TaskError(403, 'Only the person named, the host of the meeting and stewards can decide about this action point.')
  }
}

/** options.notify: false leaves out the "you are on a task" email (add all sends one email per person instead). */
async function accept (userId, id, input = {}, options = {}) {
  const row = await visibleRow(userId, id)
  await assertMayDecide(userId, row)
  if (row.status !== 'open') throw new TaskError(409, 'This action point was already decided.')

  const people = await peopleOf(row.id)
  const assigneeIds = input.assigneeIds !== undefined && input.assigneeIds !== null
    ? input.assigneeIds
    : people.filter(p => p.status !== 'declined').map(p => String(p.id))
  const title = input.title !== undefined && input.title !== null && String(input.title).trim() ? input.title : row.what.slice(0, 500)
  const dueDate = input.dueDate !== undefined ? input.dueDate : row.due_date_text
  let projectId = input.projectId !== undefined ? input.projectId : row.project_post_id
  if (input.projectId !== undefined) await Tasks.cleanProject(projectId, row.group_id) // a wrong project is a 400, before anything changes
  if (input.projectId === undefined && projectId) {
    // The suggested project may have been closed since: then the task simply has no project
    try { await Tasks.cleanProject(projectId, row.group_id) } catch (e) { projectId = null }
  }

  // Claim the action point first, so two people pressing at once make one task
  const now = new Date()
  const claimed = await knex()('agora_task_suggestions').where({ id: row.id, status: 'open' })
    .update({ status: 'accepted', decided_by_id: userId, decided_at: now, updated_at: now })
  if (!claimed) throw new TaskError(409, 'This action point was already decided.')
  let task
  try {
    task = await Tasks.create(userId, { groupId: row.group_id, title, dueDate, projectId, assigneeIds },
      { meetingSessionId: row.meeting_session_id, minutesPostId: row.minutes_post_id }, { notify: options.notify !== false })
  } catch (err) {
    await knex()('agora_task_suggestions').where({ id: row.id }).update({ status: 'open', decided_by_id: null, decided_at: null, updated_at: new Date() })
    throw err
  }
  await knex()('agora_task_suggestions').where({ id: row.id }).update({ task_id: task.id })
  const ids = task.assignees.map(a => String(a.id))
  await knex()('agora_task_suggestion_people').where({ suggestion_id: row.id }).whereIn('user_id', ids).update({ status: 'accepted' })
  return { suggestion: await presentOne(userId, row.id), task }
}

async function dismiss (userId, id) {
  const row = await visibleRow(userId, id)
  await assertMayDecide(userId, row)
  if (row.status !== 'open') throw new TaskError(409, 'This action point was already decided.')
  const now = new Date()
  await knex()('agora_task_suggestions').where({ id: row.id, status: 'open' })
    .update({ status: 'dismissed', decided_by_id: userId, decided_at: now, updated_at: now })
  return { suggestion: await presentOne(userId, row.id) }
}

/** "Not mine": takes the person off the action point. Nobody left: it stays open for the host and stewards. */
async function notMine (userId, id) {
  const row = await visibleRow(userId, id)
  if (row.status !== 'open') throw new TaskError(409, 'This action point was already decided.')
  const changed = await knex()('agora_task_suggestion_people')
    .where({ suggestion_id: row.id, user_id: userId }).whereNot('status', 'declined')
    .update({ status: 'declined' })
  if (!changed) throw new TaskError(400, 'You are not named on this action point.')
  return { suggestion: await presentOne(userId, row.id) }
}

/** Host or steward: adds every open action point that has at least one person. */
async function acceptAll (userId, { minutesPostId } = {}) {
  const session = await visibleMinutes(userId, minutesPostId)
  if (!session) throw NOT_FOUND()
  const open = await rows(q => q.where({ 's.minutes_post_id': minutesPostId, 's.status': 'open' }))
  if (!open.length) return { suggestions: [], tasks: [] }
  const groupId = open[0].group_id
  const allowed = await Tasks.isGroupMember(userId, groupId) &&
    (String(session.started_by_id) === String(userId) || await Tasks.isSteward(userId, groupId))
  if (!allowed) throw new TaskError(403, 'Only the host of the meeting and stewards can add all action points.')
  const suggestions = []
  const tasks = []
  for (const row of open) {
    const left = (await peopleOf(row.id)).filter(p => p.status !== 'declined')
    if (!left.length) continue
    try {
      const done = await accept(userId, row.id, {}, { notify: false })
      suggestions.push(done.suggestion)
      tasks.push(done.task)
    } catch (err) {
      // One that fails (for example a person who left the circle) must not stop the others
      if (!(err instanceof TaskError)) throw err
    }
  }
  // One email per person with all their tasks, never to the person who pressed the button
  const byPerson = {}
  for (const task of tasks) for (const a of task.assignees) (byPerson[a.id] = byPerson[a.id] || []).push(task.title)
  if (Object.keys(byPerson).length) TaskNotify.assignedMany({ groupId, byUserId: userId, byPerson })
  return { suggestions, tasks }
}

/**
 * Open tasks from the last meeting: tasks (not done) made from the minutes of the previous
 * meeting of the same event post, or, with none, from the most recent minutes in the
 * circle the event is in. Only for members of the event's circles.
 */
async function openFromLastTime (userId, eventPostId) {
  if (!/^\d+$/.test(String(eventPostId || ''))) throw NOT_FOUND()
  const groupIds = await knex()('groups_posts').where({ post_id: eventPostId }).pluck('group_id')
  const mineIds = new Set(await Tasks.memberGroupIds(userId))
  const visible = groupIds.map(String).filter(g => mineIds.has(g))
  if (!visible.length) throw NOT_FOUND()
  // This event's own sessions: the previous meeting is the newest one with minutes
  let minutesPostId = null
  const own = await knex()('meeting_sessions').where({ post_id: eventPostId }).whereNotNull('minutes_post_id')
    .orderBy('started_at', 'desc').orderBy('id', 'desc').first('minutes_post_id')
  if (own) minutesPostId = own.minutes_post_id
  else {
    const recent = await knex()('meeting_sessions as ms')
      .join('groups_posts as gp', 'gp.post_id', 'ms.minutes_post_id')
      .whereIn('gp.group_id', visible).whereNotNull('ms.minutes_post_id')
      .orderBy('ms.started_at', 'desc').orderBy('ms.id', 'desc').first('ms.minutes_post_id')
    if (recent) minutesPostId = recent.minutes_post_id
  }
  if (!minutesPostId) return { minutesPostId: null, tasks: [] }
  const taskRows = await knex()('agora_tasks').where({ source_minutes_post_id: minutesPostId }).whereNull('removed_at').whereNot('status', 'done')
    .whereIn('group_id', visible).orderBy('id', 'asc').pluck('id')
  const tasks = []
  for (const id of taskRows) tasks.push(await Tasks.presentOne(userId, id))
  return { minutesPostId: Number(minutesPostId), tasks }
}

module.exports = {
  groupOfPost,
  guestNamesOf,
  presentMembers,
  openProjects,
  createFromMinutes,
  listForMinutes,
  mine,
  accept,
  dismiss,
  notMine,
  acceptAll,
  openFromLastTime
}
