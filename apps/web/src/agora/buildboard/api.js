/**
 * Agora: talks to the server part of the Build page (apps/backend/lib/agora/buildBoard.js).
 * The browser never talks to GitHub. Moving a card carries an X-Agora header.
 */
const BASE = '/noo/agora/build/api'

export async function buildApi (path, body) {
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

let accessPromise = null

/** Whether the person may see the Build page and for which circle. Asked once per page load. */
export function loadAccess () {
  if (!accessPromise) {
    accessPromise = buildApi('/access').catch(() => {
      accessPromise = null
      return { allowed: false, circle: null }
    })
  }
  return accessPromise
}

export function resetAccess () {
  accessPromise = null
}

/** Minutes since an ISO time, never negative. */
export function minutesAgo (iso, now = Date.now()) {
  if (!iso) return 0
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
}
