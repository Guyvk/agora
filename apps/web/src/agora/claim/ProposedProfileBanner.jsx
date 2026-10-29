/**
 * Agora: "We found your profile from the activist council. Is this you?"
 * Shown inside the app, for a logged-in member who has a profile proposed to
 * them (by a steward, or guessed from the names). "Have a look" opens the claim
 * page inside the app, where they confirm. "This isn't me" is remembered.
 * "Not now" hides it until the page is reloaded (this session only).
 * The server part is apps/backend/lib/agora/claims.js.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Button from 'components/ui/button'
import { claimApi } from './api'

const HIDDEN_KEY = 'agora-proposal-hidden'

function hiddenNow () {
  try { return window.sessionStorage.getItem(HIDDEN_KEY) === '1' } catch (e) { return false }
}

export default function ProposedProfileBanner () {
  const { t } = useTranslation()
  const [proposal, setProposal] = useState(null)
  const [hidden, setHidden] = useState(hiddenNow())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (hidden) return undefined
    let stopped = false
    claimApi('/proposal')
      .then(data => { if (!stopped) setProposal(data.proposal || null) })
      .catch(() => {})
    return () => { stopped = true }
  }, [hidden])

  if (hidden || !proposal) return null

  const notNow = () => {
    try { window.sessionStorage.setItem(HIDDEN_KEY, '1') } catch (e) {}
    setHidden(true)
  }

  const notMe = async () => {
    setBusy(true)
    try {
      await claimApi('/proposal/dismiss', { contactId: proposal.contactId })
      setProposal(null)
    } catch (e) {
      setBusy(false)
    }
  }

  return (
    <div role='region' aria-label={t('Your profile')} data-testid='proposed-profile-banner' className='fixed z-[900] left-2 right-2 bottom-2 sm:left-auto sm:right-6 sm:bottom-24 sm:w-[380px] rounded-lg border-2 border-accent bg-background p-3 shadow-lg flex flex-col gap-2'>
      <p className='m-0 font-semibold text-foreground'>{t('We found your profile from the activist council. Is this you?')}</p>
      <p className='m-0 text-sm text-muted-foreground'>{proposal.profile.name}</p>
      <div className='flex flex-wrap gap-2'>
        <Button asChild size='sm'><Link to='/claim/proposal'>{t('Have a look')}</Link></Button>
        <Button size='sm' variant='outline' onClick={notMe} disabled={busy}>{t("This isn't me")}</Button>
        <Button size='sm' variant='ghost' onClick={notNow}>{t('Not now')}</Button>
      </div>
    </div>
  )
}
