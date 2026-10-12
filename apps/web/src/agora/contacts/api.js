/**
 * Agora: talks to the server part of the Contacts page (apps/backend/lib/agora/contacts.js).
 * Changes carry an X-Agora header, which the server requires for them.
 */
const BASE = '/noo/agora/contacts/api'

export async function contactsApi (path, body) {
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
