import { useEffect, useState } from 'react'

/**
 * Agora: sign-up by invitation only. The server decides and checks the
 * invitation itself (apps/backend/lib/agora/signup.js); this only lets the
 * sign-up page explain it before anyone types an email address.
 */

/**
 * The invitation someone came with. An invitation link (/h/use-invitation?token=...)
 * or a circle's join link (/groups/<circle>/join/<code>) leads to the sign-up
 * page, and keeps where to go afterwards in returnToPath, for example
 * /groups/governance/about?accessCode=abc or ...?token=xyz.
 * Returns { invitationToken } or { accessCode }, or null when there is none.
 */
export function invitationFromPath (path) {
  if (!path || typeof path !== 'string') return null
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  const accessCode = params.get('accessCode')
  if (accessCode) return { accessCode }
  const invitationToken = params.get('token')
  if (invitationToken) return { invitationToken }
  return null
}

/** Asks the server whether new accounts need an invitation. */
export async function fetchInviteOnly () {
  const res = await fetch('/noo/agora/signup', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`The server answered ${res.status}`)
  const body = await res.json()
  return body.inviteOnly === true
}

/**
 * true or false once the server has answered, null until then. If the server
 * cannot be asked, false: the form is shown and the server still refuses a
 * sign-up without an invitation.
 */
export function useInviteOnly () {
  const [inviteOnly, setInviteOnly] = useState(null)

  useEffect(() => {
    let stopped = false
    const done = value => { if (!stopped) setInviteOnly(value) }
    if (typeof fetch !== 'function') {
      done(false)
    } else {
      fetchInviteOnly().then(done, () => done(false))
    }
    return () => { stopped = true }
  }, [])

  return inviteOnly
}
