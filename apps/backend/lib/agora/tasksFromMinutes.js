/**
 * Agora: makes suggested tasks from minutes posts that were written before this feature.
 * Used by scripts/agora-tasks-from-minutes.js. Reads the "Actions" list from the post
 * (<h3>Actions</h3><ul><li><strong>Name</strong>: what (by YYYY-MM-DD)</li>...), matches
 * the names to members who were in that meeting, and (only with apply) stores suggestions.
 * Posts that already have suggestions are skipped. Nobody is emailed about old meetings.
 */
const TaskSuggestions = require('./taskSuggestions')
const { parseActionsHtml, whoList, matchName, isEveryone, isGuestName } = require('./minutesActions')

const knex = () => bookshelf.knex

async function backfill ({ apply = false, log = () => {} } = {}) {
  const sessions = await knex()('meeting_sessions as ms')
    .join('posts as p', 'p.id', 'ms.minutes_post_id')
    .whereNotNull('ms.minutes_post_id')
    .orderBy('ms.id', 'asc')
    .select('ms.id as session_id', 'ms.minutes_post_id', 'p.name as post_name', 'p.description')
  const result = { posts: 0, skipped: 0, actions: 0, created: 0 }
  for (const s of sessions) {
    const existing = await knex()('agora_task_suggestions').where({ minutes_post_id: s.minutes_post_id }).first('id')
    if (existing) { result.skipped++; log(`Post ${s.minutes_post_id} (${s.post_name}): already has suggestions, skipped.`); continue }
    const actions = parseActionsHtml(s.description)
    if (!actions.length) continue
    result.posts++
    const groupId = await TaskSuggestions.groupOfPost(s.minutes_post_id)
    const members = groupId ? await TaskSuggestions.presentMembers(s.session_id, groupId) : []
    const guestNames = await TaskSuggestions.guestNamesOf(s.session_id)
    log(`Post ${s.minutes_post_id} (${s.post_name}): ${actions.length} action point(s), ${members.length} member(s) present.`)
    for (const a of actions) {
      result.actions++
      const names = whoList(a.who)
      const shown = names.map(n => {
        if (isGuestName(n, guestNames)) return `${n} -> no match (guest)`
        const m = matchName(n, members)
        if (m) return `${n} -> ${m.id} ${m.name}`
        return isEveryone(n) ? `${n} -> everyone present (${members.length} suggestion(s))` : `${n} -> no match`
      })
      log(`  ${shown.join('; ') || '(no name)'} | ${a.what}${a.due ? ` | due ${a.due}` : ''}`)
    }
    if (apply) {
      const { created, error } = await TaskSuggestions.createFromMinutes({ sessionId: s.session_id, minutesPostId: s.minutes_post_id, actions, apply: true, notify: false })
      if (error) log(`  Could not store this post: ${error.message}`)
      result.created += created.length
    }
  }
  return result
}

module.exports = { backfill }
