import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import checkInvitation from 'store/actions/checkInvitation'

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
 * A claim link for a profile (/claim/<secret>, see ../claim/ClaimPage.jsx)
 * keeps itself there too, and counts as permission to sign up.
 * Returns { invitationToken }, { accessCode } or { claimToken }, or null when there is none.
 */
export function invitationFromPath (path) {
  if (!path || typeof path !== 'string') return null
  const claim = path.match(CLAIM_PATH)
  if (claim) return { claimToken: claim[1] }
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  const accessCode = params.get('accessCode')
  if (accessCode) return { accessCode }
  const invitationToken = params.get('token')
  if (invitationToken) return { invitationToken }
  return null
}

/** The address of a claim link: /claim/ and 43 letters, digits, "-" or "_". */
const CLAIM_PATH = /^\/claim\/([A-Za-z0-9_-]{43})\/?(?:[?#].*)?$/

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

/** An email address as Agora compares them: trimmed and in small letters. */
function normalAddress (value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * True when someone who is logged in opens an email invitation that was sent
 * to another address. Agora does not use such an invitation: it belongs to
 * the address it was sent to (the server checks this too). A join link has no
 * address and fits everyone.
 */
export function isInvitationForOtherAccount ({ invitationToken, invitationEmail, myEmail }) {
  if (!invitationToken || !normalAddress(invitationEmail) || !normalAddress(myEmail)) return false
  return normalAddress(invitationEmail) !== normalAddress(myEmail)
}

/** The answer of the checkInvitation query, however the store hands it back. */
export function checkResultOf (result) {
  return result?.payload?.data?.checkInvitation ?? result?.payload?.getData?.() ?? null
}

/**
 * The address an email invitation was sent to, so the sign-up page can fill
 * it in. null for a join link, an unknown invitation, or until the server has
 * answered.
 */
export function useInvitationEmail (invitation) {
  const dispatch = useDispatch()
  const invitationToken = invitation?.invitationToken
  const [email, setEmail] = useState(null)

  useEffect(() => {
    if (!invitationToken) return
    let stopped = false
    Promise.resolve(dispatch(checkInvitation({ invitationToken })))
      .then(result => {
        const check = checkResultOf(result)
        if (!stopped && check?.valid && check.email) setEmail(check.email)
      })
      .catch(() => {})
    return () => { stopped = true }
  }, [invitationToken])

  return email
}

/** The invitation link from an invitation email, to come back to after logging out. */
export function invitationLink (invitationToken, invitationEmail) {
  return `/h/use-invitation?token=${encodeURIComponent(invitationToken)}&email=${encodeURIComponent(invitationEmail)}`
}
