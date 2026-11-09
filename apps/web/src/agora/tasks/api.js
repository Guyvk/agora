/**
 * Agora: talks to the server part of Tasks (apps/backend/lib/agora/tasks.js).
 * Changes carry an X-Agora header, which the server requires for them.
 */
const BASE = '/noo/agora/tasks/api'

export const STATUSES = ['todo', 'doing', 'done']

export async function tasksApi (path, body) {
  const options = { credentials: 'same-origin', headers: { 'X-Agora': '1' } }
  if (body !== undefined) {
    options.method = 'POST'
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || 'Something went wrong. Try again in a minute.')
    error.status = res.status
    throw error
  }
  return data
}

/** Today's date on this computer as YYYY-MM-DD (the Swedish format happens to be exactly that). */
export function today () {
  return new Date().toLocaleDateString('sv-SE')
}

/** A plain date 'YYYY-MM-DD' shown as a local date (never parsed as UTC). */
export function formatDay (day) {
  return day ? new Date(day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
}

export function isOverdue (task, todayString = today()) {
  return !!task.dueDate && task.status !== 'done' && task.dueDate < todayString
}

export function initials (name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

/** Tasks of one status, in board order. */
export function column (tasks, status) {
  return tasks.filter(t => t.status === status).sort((a, b) => a.position - b.position)
}

/** The position for a card dropped at `index` in `list` (the column without the moved card). */
export function positionAt (list, index) {
  if (list.length === 0) return 0
  if (index <= 0) return list[0].position - 1
  if (index >= list.length) return list[list.length - 1].position + 1
  return (list[index - 1].position + list[index].position) / 2
}
