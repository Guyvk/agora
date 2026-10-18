import React from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'

/**
 * Agora: what the sign-up page shows on an invitation-only Agora to someone
 * who came without an invitation, instead of the email box.
 */
export default function AgoraInviteOnlyNotice () {
  const { t } = useTranslation()
  return (
    <>
      <Helmet>
        <title>{t('Sign up for Hylo')}</title>
      </Helmet>
      <div className='bg-midground shadow-md rounded-md p-4 w-full max-w-[320px] mx-auto' data-testid='agora-invite-only'>
        <h1 className='text-2xl font-bold mb-2 text-foreground text-center'>{t('Agora is by invitation')}</h1>
        <p className='mb-2 text-foreground/80 text-center mt-0'>
          {t('To make an account you need an invitation to a circle. Ask a 7BP steward for one.')}
        </p>
        <p className='mb-0 text-foreground/80 text-center mt-0'>
          {t('Got an invitation? Open the link in the invitation email, or the join link you were sent.')}
        </p>
      </div>
    </>
  )
}
