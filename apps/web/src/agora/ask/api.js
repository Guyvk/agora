/**
 * Agora: talks to the server part of a circle's Ask tab (apps/backend/lib/agora/ask.js).
 * Who may ask what is checked there, not here. Changes carry an X-Agora
 * header, which the server requires for them.
 */
const BASE = '/noo/agora/ask/api'

export const ASK_URL = groupSlug => `/groups/${groupSlug}/ask`

export async function askApi (path, body) {
  const options = { credentials: 'same-origin', headers: { 'X-Agora': '1', Accept: 'application/json' } }
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
    error.code = data.code || null
    throw error
  }
  return data
}

export const askStatus = groupSlug => askApi(`/${encodeURIComponent(groupSlug)}/status`)
export const askHistory = groupSlug => askApi(`/${encodeURIComponent(groupSlug)}/history`)
export const askQuestion = (groupSlug, question) => askApi(`/${encodeURIComponent(groupSlug)}/ask`, { question })
export const shareAnswer = questionId => askApi(`/answers/${encodeURIComponent(questionId)}/share`, {})
