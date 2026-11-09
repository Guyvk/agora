/**
 * Agora: tells people by email about tasks (Agora's own mailer, lib/agora/mailer.js).
 *
 *   - suggested: the minutes of a meeting suggest tasks for you (one email per person)
 *   - assigned:  someone put you on a task
 *
 * Nobody is mailed who switched email off: the circle's own "email" setting (Hylo's
 * per-circle sendEmail) or "unsubscribe from all" (post notifications set to none).
 * Sending never stops what the person did: it runs in the background and a failure is only
 * logged. There is no bell notification: Hylo's activity system has no kind for tasks, and
 * adding one would be a big change in many Hylo files.
 */
const knex = () => bookshelf.knex

function appUrl (pathname) {
  return `${process.env.PROTOCOL || 'http'}://${process.env.DOMAIN || 'localhost:3000'}${pathname}`
}

function defaultSender (options) {
  const mailer = require('./mailer')
  return new Promise(resolve => mailer.send(options, (err, result) => resolve(!err && Boolean(result) && !(result && result.skipped))))
}

let sender = defaultSender

/** For tests: replace how an email is sent. Call with nothing to put the real one back. */
function setSender (fn) {
  sender = fn || defaultSender
}

/** The people of this list who may get email about this circle: { id, email, name }. */
async function mailable (userIds, groupId) {
  const ids = [...new Set((userIds || []).map(String))]
  if (!ids.length) return []
  return knex()('users')
    .whereIn('users.id', ids)
    .where('users.active', true)
    .whereNotNull('users.email')
    .whereRaw("coalesce(users.settings->>'post_notifications', '') <> 'none'")
    .whereExists(function () {
      this.select(1).from('group_memberships')
        .whereRaw('group_memberships.user_id = users.id')
        .where({ 'group_memberships.group_id': groupId, 'group_memberships.active': true })
        .whereRaw("(group_memberships.settings->>'sendEmail') is distinct from 'false'")
    })
    .select('users.id', 'users.email', 'users.name')
}

function send (person, emailId, data) {
  return sender({
    email_id: emailId,
    recipient: { address: person.email },
    sender: { address: process.env.EMAIL_SENDER, name: process.env.AGORA_EMAIL_SENDER_NAME || 'Agora' },
    email_data: { name: person.name, ...data }
  })
}

/**
 * The minutes suggest tasks. byPerson: { userId: [text of each action point for that person] }.
 * Returns a promise that never rejects.
 */
async function suggested ({ groupId, meeting, date, byPerson }) {
  try {
    const people = await mailable(Object.keys(byPerson), groupId)
    for (const person of people) {
      try {
        await send(person, 'agora_task_suggested', { meeting, date, items: byPerson[String(person.id)] || [], url: appUrl('/my-tasks') })
      } catch (err) {
        console.error('Agora tasks: a suggestion email could not be sent:', err && err.message)
      }
    }
  } catch (err) {
    console.error('Agora tasks: suggestion emails stopped:', err && err.message)
  }
}

/** Someone put these people on a task. Not the person who did it. */
async function assigned ({ task, userIds, byUserId }) {
  try {
    const ids = (userIds || []).filter(id => String(id) !== String(byUserId))
    const people = await mailable(ids, task.groupId)
    if (!people.length) return
    const by = byUserId ? await knex()('users').where({ id: byUserId }).first('name') : null
    for (const person of people) {
      try {
        await send(person, 'agora_task_assigned', {
          title: task.title,
          by: by ? by.name : null,
          group: task.groupName,
          url: appUrl(`/groups/${encodeURIComponent(task.groupSlug)}/tasks?task=${encodeURIComponent(task.id)}`)
        })
      } catch (err) {
        console.error('Agora tasks: an assignment email could not be sent:', err && err.message)
      }
    }
  } catch (err) {
    console.error('Agora tasks: assignment emails stopped:', err && err.message)
  }
}

/**
 * Several tasks at once (add all): one email per person listing their tasks, not to the person
 * who did it. byPerson: { userId: [task titles] }.
 */
async function assignedMany ({ groupId, byUserId, byPerson }) {
  try {
    const ids = Object.keys(byPerson).filter(id => String(id) !== String(byUserId))
    const people = await mailable(ids, groupId)
    if (!people.length) return
    const by = byUserId ? await knex()('users').where({ id: byUserId }).first('name') : null
    for (const person of people) {
      try {
        await send(person, 'agora_task_assigned', { items: byPerson[String(person.id)] || [], by: by ? by.name : null, url: appUrl('/my-tasks') })
      } catch (err) {
        console.error('Agora tasks: an assignment email could not be sent:', err && err.message)
      }
    }
  } catch (err) {
    console.error('Agora tasks: assignment emails stopped:', err && err.message)
  }
}

module.exports = { suggested, assigned, assignedMany, mailable, setSender }
