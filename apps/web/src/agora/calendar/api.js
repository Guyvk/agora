/**
 * Agora: talks to the server part of the calendar (apps/backend/lib/agora/calendar.js),
 * and knows the two kinds of event posts, Meetings and Events
 * (apps/backend/lib/agora/eventKinds.js). Changes carry an X-Agora header,
 * which the server requires for them.
 */
import { useEffect, useState } from 'react'

const BASE = '/noo/agora/calendar/api'
export const CALENDAR_URL = '/calendar'

export const MEETING = 'meeting'
export const EVENT = 'event'

/** 'meeting', 'event', or null for posts that are not events. An event post without a kind is a Meeting. */
export function agoraKindOf (post) {
  if (!post || post.type !== 'event') return null
  return post.agoraKind === EVENT ? EVENT : MEETING
}

export async function calendarApi (path, body) {
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

const NOTHING = { canMarkForAll: false, mainGroup: null }
let asked = null
/** For tests: forget the answer to "may I mark things for all of 7BP?" */
export function forgetCalendarMe () { asked = null }

/** Whether the logged-in person is a steward of the main 7BP circle, asked once per page load. */
export function useCalendarMe () {
  const [me, setMe] = useState(NOTHING)
  useEffect(() => {
    let alive = true
    if (!asked) {
      asked = calendarApi('/me')
        .then(r => ({ canMarkForAll: Boolean(r && r.canMarkForAll), mainGroup: (r && r.mainGroup) || null }))
        .catch(() => { asked = null; return NOTHING })
    }
    asked.then(value => { if (alive) setMe(value) })
    return () => { alive = false }
  }, [])
  return me
}
