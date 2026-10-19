/**
 * Agora: talks to the server part of Help and the Help desk (apps/backend/lib/agora/help.js).
 * Changes carry an X-Agora header, which the server requires for them.
 */
const BASE = '/noo/agora/help/api'

export async function helpApi (path, body) {
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

/** What the Help window records by itself: the page, the browser and the screen. */
export function helpContext () {
  const w = typeof window !== 'undefined' ? window : {}
  const screen = w.screen || {}
  const ratio = w.devicePixelRatio && w.devicePixelRatio !== 1 ? ` @${Math.round(w.devicePixelRatio * 100) / 100}x` : ''
  return {
    page: w.location ? w.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    screen: screen.width ? `${screen.width}x${screen.height}${ratio}` : ''
  }
}

export const HELP_DESK_URL = '/help-desk'

export function formatMoment (iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/** The words for statuses, types and urgencies, through the locales. */
export function helpLabels (t) {
  return {
    statuses: { new: t('New'), looking: t('Looking at it'), building: t('Being built'), fixed: t('Fixed'), wont_do: t('Won\'t do') },
    types: { fault: t('Something is wrong'), wish: t('A wish'), question: t('A question') },
    shortTypes: { fault: t('Fault'), wish: t('Wish'), question: t('Question') },
    urgencies: { low: t('Not urgent'), normal: t('Normal'), urgent: t('Urgent: I am stuck') }
  }
}
