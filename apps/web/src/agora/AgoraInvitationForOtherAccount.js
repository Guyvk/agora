import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useTranslation } from 'react-i18next'
import Button from 'components/ui/button'
import logout from 'store/actions/logout'
import { invitationLink } from './signup'

/**
 * Agora: shown when someone who is logged in opens an invitation email that
 * was sent to another address. The invitation is not used. "Log out and
 * continue" logs out and opens the invitation link again, so the right person
 * can accept it (or make an account for that address).
 */
// A full page load, so nothing of the old login stays in the app
const openPage = url => window.location.assign(url)

export default function AgoraInvitationForOtherAccount ({ invitationToken, invitationEmail, myName, myEmail, goTo = openPage }) {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const [busy, setBusy] = useState(false)

  const logOutAndContinue = async () => {
    setBusy(true)
    try {
      await dispatch(logout())
    } catch (err) {
      // Going to the link reloads the page either way; a failed logout shows the same page again
    }
    goTo(invitationLink(invitationToken, invitationEmail))
  }

  return (
    <div className='bg-midground shadow-md rounded-md p-4 w-full max-w-[420px] mx-auto mt-8' data-testid='agora-invitation-other-account'>
      <h1 className='text-2xl font-bold mb-2 text-foreground text-center'>{t('This invitation is for {{email}}.', { email: invitationEmail })}</h1>
      <p className='mb-2 text-foreground/80 text-center mt-0'>
        {t('You are logged in as {{name}} ({{email}}).', { name: myName, email: myEmail })}
      </p>
      <p className='mb-4 text-foreground/80 text-center mt-0'>
        {t('Log out to accept it as {{email}}.', { email: invitationEmail })}
      </p>
      <Button
        variant='highVisibility'
        className='w-full rounded-md p-2 text-base'
        onClick={logOutAndContinue}
        disabled={busy}
      >
        {t('Log out and continue')}
      </Button>
      <p className='mt-3 mb-0 text-center text-sm'>
        <a href='/' className='text-foreground/70 underline'>{t('Stay logged in as {{name}}', { name: myName })}</a>
      </p>
    </div>
  )
}
