/**
 * Agora: talks to the server part of the admin area (apps/backend/lib/agora/adminDashboard.js).
 * Every request carries an X-Agora header, which the server requires, also for reading.
 */
import { useEffect, useState } from 'react'

const BASE = '/noo/agora/admin/api'
export const ADMIN_URL = '/admin'

export async function adminApi (path, body) {
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

const NOBODY = { isAdmin: false, helpDesk: false }
let asked = null
/** For tests: forget the answer to "what may I open?" */
export function forgetAdminCheck () { asked = null }

/** What the logged-in person may open: the whole admin area (isAdmin), or only its Help desk tab (helpDesk). */
export function adminAccess () {
  if (!asked) {
    asked = adminApi('/me')
      .then(r => ({ isAdmin: Boolean(r && r.isAdmin), helpDesk: Boolean(r && (r.helpDesk || r.isAdmin)) }))
      .catch(() => { asked = null; return NOBODY })
  }
  return asked
}

/** The same as a hook, asked once per page load. Before the answer: nothing. */
export function useAgoraAdmin () {
  const [access, setAccess] = useState(NOBODY)
  useEffect(() => {
    let alive = true
    adminAccess().then(value => { if (alive) setAccess(value) })
    return () => { alive = false }
  }, [])
  return access
}

export function formatBytes (bytes) {
  if (bytes == null) return '-'
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let value = Number(bytes)
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}
