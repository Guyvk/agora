/**
 * Agora: the claim page, /claim/<secret>. Someone opens the claim link a
 * steward gave them and sees the profile made from their sheet at the
 * activist council. Not logged in: they make an account with their own email
 * address (the link counts as their invitation) or log in, and come back here.
 * Logged in: they confirm, and the profile becomes part of their own.
 * The server part is apps/backend/lib/agora/claims.js.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import AgoraLogo from '@/agora/AgoraLogo'
import Button from 'components/ui/button'
import Loading from 'components/Loading'
import setReturnToPath from 'store/actions/setReturnToPath'
import getMe from 'store/selectors/getMe'
import getReturnToPath from 'store/selectors/getReturnToPath'
import { claimApi } from './api'

export function ProfileCard ({ profile }) {
  const { t } = useTranslation()
  return (
    <div className='flex flex-col gap-4 rounded-lg border border-border bg-card p-4'>
      <div className='flex flex-col sm:flex-row gap-4'>
        {profile.photoUrl && (
          <a href={profile.photoUrl} target='_blank' rel='noreferrer' className='shrink-0'>
            <img src={profile.photoUrl} alt={t('The photo of your sheet')} className='w-full sm:w-48 max-h-72 object-contain rounded-md border border-border bg-background' />
          </a>
        )}
        <div className='min-w-0 flex flex-col gap-3'>
          <h2 className='text-2xl font-bold text-foreground m-0 break-words'>{profile.name}</h2>
          {profile.country && <p className='m-0 text-foreground/80'>{profile.country}</p>}
          {profile.offers && (
            <div>
              <h3 className='text-sm font-semibold text-muted-foreground m-0'>{t('What I do and can do')}</h3>
              <p className='m-0 whitespace-pre-wrap break-words text-foreground'>{profile.offers}</p>
            </div>
          )}
          {profile.whyHere && (
            <div>
              <h3 className='text-sm font-semibold text-muted-foreground m-0'>{t('Why I am here')}</h3>
              <p className='m-0 whitespace-pre-wrap break-words text-foreground'>{profile.whyHere}</p>
            </div>
          )}
          {profile.skills && profile.skills.length > 0 && (
            <div>
              <h3 className='text-sm font-semibold text-muted-foreground m-0'>{t('Skills')}</h3>
              <p className='m-0 text-foreground'>{profile.skills.join(', ')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ClaimPage ({ loggedIn = false }) {
  const { t } = useTranslation()
  const { token } = useParams()
  const dispatch = useDispatch()
  const me = useSelector(getMe)
  const returnToPath = useSelector(getReturnToPath)
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [removed, setRemoved] = useState(false)
  const here = `/claim/${token}`

  // Back here after signing up or logging in: this page is where they were going
  useEffect(() => {
    if (loggedIn && returnToPath && String(returnToPath).startsWith('/claim/')) dispatch(setReturnToPath(null))
  }, [loggedIn, returnToPath])

  useEffect(() => {
    let stopped = false
    claimApi(`/${encodeURIComponent(token || '')}`)
      .then(data => { if (!stopped) setProfile(data.profile) })
      .catch(e => { if (!stopped) setError(e.status === 404 ? 'gone' : e.message) })
    return () => { stopped = true }
  }, [token])

  const claim = async () => {
    setBusy(true)
    setError(null)
    try {
      setDone(await claimApi(`/${encodeURIComponent(token)}/claim`, {}))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // The person who claimed deletes what the sheet left in Contacts (their profile keeps what was copied)
  const removeSheetData = async () => {
    setBusy(true)
    setError(null)
    try {
      await claimApi('/remove-sheet-data', {})
      setRemoved(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  let body
  if (done) {
    body = (
      <div role='status' className='flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4 text-foreground'>
        <p className='m-0 font-semibold'>{t('Done. The profile from your sheet is now part of your profile in Agora.')}</p>
        <p className='m-0'>{t('Only what was still empty in your profile was filled in. You can change all of it in your profile settings.')}</p>
        {done.joinedGroup && <p className='m-0'>{t('You are now a member of {{circle}}.', { circle: done.joinedGroup.name })}</p>}
        <div className='flex flex-wrap gap-2'>
          <Button asChild><a href={`/members/${done.userId}`}>{t('See my profile')}</a></Button>
          {done.joinedGroup && <Button asChild variant='outline'><a href={`/groups/${done.joinedGroup.slug}`}>{t('Open {{circle}}', { circle: done.joinedGroup.name })}</a></Button>}
        </div>
        {removed
          ? <p className='m-0 font-semibold'>{t('The sheet data in Contacts is deleted.')}</p>
          : (
            <div className='flex flex-col gap-2 border-t border-border pt-3'>
              <p className='m-0 text-sm text-muted-foreground'>{t('You can also delete what the sheet left in Contacts (country, what you do, why you are here, skills and photo). What is already in your profile stays.')}</p>
              {error && <p role='alert' className='m-0 text-sm text-destructive'>{error}</p>}
              <div><Button variant='outline' onClick={removeSheetData} disabled={busy}>{t('Remove my sheet data')}</Button></div>
            </div>
            )}
      </div>
    )
  } else if (error === 'gone') {
    body = (
      <div role='alert' className='rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-foreground'>
        <p className='m-0 font-semibold'>{t('This claim link does not work.')}</p>
        <p className='m-0 mt-1'>{t('It may have been used already, or a steward made a new one. Ask the 7BP team for a new link.')}</p>
      </div>
    )
  } else if (!profile && !error) {
    body = <Loading />
  } else {
    body = (
      <div className='flex flex-col gap-4'>
        <p className='m-0 text-foreground'>{t('This is the profile made from your sheet at the activist council. Is this you? Then make it your own: it becomes part of your profile in Agora, and you can change it there.')}</p>
        {profile && <ProfileCard profile={profile} />}
        {error && <p role='alert' className='m-0 text-sm text-destructive'>{error}</p>}
        {profile && loggedIn && (
          <div className='flex flex-col gap-2'>
            {me && me.name && <p className='m-0 text-sm text-muted-foreground'>{t('You are logged in as {{name}}.', { name: me.name })}</p>}
            <div className='flex flex-wrap gap-2'>
              <Button onClick={claim} disabled={busy}>{t('Yes, this is me: add it to my profile')}</Button>
            </div>
            <p className='m-0 text-sm text-muted-foreground'>{t('Not your sheet? Then close this page and tell the person who sent you the link.')}</p>
          </div>
        )}
        {profile && !loggedIn && (
          <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap gap-2'>
              <Button asChild><Link to={`/signup?returnToUrl=${encodeURIComponent(here)}`}>{t('Make my account')}</Link></Button>
              <Button asChild variant='outline'><Link to={`/login?returnToUrl=${encodeURIComponent(here)}`}>{t('I have an account: log in')}</Link></Button>
            </div>
            <p className='m-0 text-sm text-muted-foreground'>{t('Use your own email address. After that you come back here to confirm.')}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto bg-background text-foreground' data-testid='agora-claim'>
      <Helmet>
        <title>{t('Your profile')} | Agora</title>
        <meta name='referrer' content='no-referrer' />
      </Helmet>
      <main className='max-w-2xl mx-auto px-4 py-8 text-base flex flex-col gap-4'>
        <div className='inline-flex items-center gap-3'>
          <AgoraLogo className='h-10' />
          <span className='text-xl font-bold'>Agora</span>
        </div>
        <h1 className='text-3xl font-bold m-0'>{t('Your profile')}</h1>
        {body}
      </main>
    </div>
  )
}
