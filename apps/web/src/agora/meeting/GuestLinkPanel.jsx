/**
 * Agora: the guest link of an event, on the event's own page.
 *
 * Every active member of the event's circle can see and copy the guest link,
 * and make one when there is none (canUse). Guests open it, give their name
 * and join the same call as members (apps/backend/api/controllers/MeetingGuestController.js).
 *
 * Only the person who made the event, the person who made the link and the
 * circle's stewards can revoke it or replace it with a new one (canManage).
 * People outside the circle see nothing here.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import { UserPlus } from 'lucide-react'

const base = postId => `/noo/meeting/${encodeURIComponent(postId)}/guest-link`

async function call (url, method = 'GET') {
  const options = { method, credentials: 'same-origin', headers: { 'X-Agora': '1' } }
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || '')
    error.status = res.status
    throw error
  }
  return data
}

function formatDate (iso) {
  const date = DateTime.fromISO(typeof iso === 'string' ? iso : new Date(iso).toISOString())
  return date.isValid ? date.toLocaleString(DateTime.DATETIME_MED) : ''
}

export default function GuestLinkPanel ({ postId }) {
  const { t } = useTranslation()
  const [info, setInfo] = useState(null)
  const [freshUrl, setFreshUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let stopped = false
    setInfo(null)
    setFreshUrl(null)
    if (!postId) return
    call(base(postId))
      .then(data => { if (!stopped) setInfo(data) })
      .catch(() => { if (!stopped) setInfo(null) })
    return () => { stopped = true }
  }, [postId])

  const make = useCallback(async () => {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const data = await call(base(postId), 'POST')
      setFreshUrl(data.url)
      // whoever made the link may also revoke it
      setInfo(current => ({ ...current, link: data.link, url: data.url, canManage: true }))
    } catch (e) {
      setError(e.message || t('Something went wrong. Try again in a minute.'))
    } finally {
      setBusy(false)
    }
  }, [postId, t])

  const revoke = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await call(base(postId) + '/revoke', 'POST')
      setFreshUrl(null)
      setCopied(false)
      setInfo(current => ({ ...current, link: null, url: null }))
    } catch (e) {
      setError(e.message || t('Something went wrong. Try again in a minute.'))
    } finally {
      setBusy(false)
    }
  }, [postId, t])

  const shownUrl = freshUrl || info?.url || null

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shownUrl)
      setCopied(true)
    } catch (e) {
      setCopied(false)
      setError(t('Copying did not work. Select the link and copy it yourself.'))
    }
  }, [shownUrl, t])

  if (!info || !(info.canUse || info.canManage)) return null

  const link = info.link
  const revoked = !!link?.revoked
  const working = link && !revoked && !link.expired
  // After a revoke, only the event's author, the link's maker and stewards can make a new one.
  const mayMake = info.canManage || !revoked
  const buttonClass = 'border-2 border-foreground/20 rounded-lg px-3 py-1 text-sm hover:border-foreground/50 transition-all disabled:opacity-50'

  return (
    <div className='border-2 border-foreground/20 rounded-lg p-3 mt-2 border-dashed text-left text-sm' data-testid='agora-guest-link'>
      <div className='flex items-center gap-2 font-bold'>
        <UserPlus className='w-4 h-4 shrink-0 text-foreground/50' />
        {t('Guests from outside Agora')}
      </div>
      <p className='text-foreground/70 mt-1 mb-2'>
        {t('Invite people without an Agora account to this meeting. They open the link, give their name and join the same call. They see nothing else in Agora.')}
      </p>

      {!info.available && (
        <p className='text-foreground/70'>{t('Guest links need the call inside Agora, which is not switched on here.')}</p>
      )}

      {info.available && shownUrl && (
        <div className='flex flex-col gap-2'>
          <div className='flex flex-row gap-2 items-center'>
            <input
              readOnly
              value={shownUrl}
              aria-label={t('Guest link')}
              onFocus={e => e.target.select()}
              className='flex-1 min-w-0 bg-background border-2 border-foreground/20 rounded-md px-2 py-1 text-xs'
            />
            <button type='button' className={buttonClass} onClick={copy}>{copied ? t('Copied') : t('Copy')}</button>
          </div>
          <p className='text-foreground/70'>
            {t('Anyone with this link can join the call until {{date}}, so share it only with the people you invite.', { date: formatDate(link?.expiresAt) })}
          </p>
        </div>
      )}

      {info.available && !shownUrl && link && (
        <p className='text-foreground/70'>
          {revoked
            ? (info.canManage
                ? t('The guest link was revoked.')
                : t('The guest link was revoked. To invite guests, ask the person who made the meeting or a steward of the circle.'))
            : link.expired
            ? t('The guest link has expired.')
            : info.canManage
              ? t('There is a guest link that works until {{date}}. Agora cannot show it again. If you need it, make a new one: the old one then stops working.', { date: formatDate(link.expiresAt) })
              : t('There is a guest link that works until {{date}}, made before Agora could show it again. Ask the person who made it or a steward of the circle.', { date: formatDate(link.expiresAt) })}
        </p>
      )}

      {info.available && mayMake && (!working || info.canManage) && (
        <div className='flex flex-row flex-wrap gap-2 mt-2'>
          <button type='button' className={buttonClass} onClick={make} disabled={busy}>
            {working ? t('Make a new guest link') : t('Make a guest link')}
          </button>
          {working && info.canManage && (
            <button type='button' className={buttonClass} onClick={revoke} disabled={busy}>{t('Revoke')}</button>
          )}
        </div>
      )}

      {error && <p className='text-destructive mt-2' role='alert'>{error}</p>}
    </div>
  )
}
