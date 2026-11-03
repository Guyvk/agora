/**
 * Agora: talks to the server part of the claim page (apps/backend/api/controllers/AgoraClaimController.js).
 * Claiming carries an X-Agora header, which the server requires for it.
 */
const BASE = '/noo/agora/claim/api'

export async function claimApi (path, body) {
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
