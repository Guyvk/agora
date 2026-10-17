import React from 'react'
import { useTranslation } from 'react-i18next'
import Button from 'components/ui/button'
import { cn } from 'util/index'

/**
 * Agora: the cookie notice. It says which cookies Agora uses and has one
 * button. There is no analytics or support switch, because Agora has neither.
 * Pressing the button saves "no analytics, no support".
 */
export default function AgoraCookieNotice ({ onAccept }) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'fixed z-[1000] bg-background border-foreground/20 shadow-lg',
        'left-0 right-0 bottom-0 w-full rounded-none border-t-2 p-2',
        'sm:right-6 sm:bottom-6 sm:w-[350px] sm:max-w-full sm:rounded-lg sm:border-2 sm:left-auto'
      )}
    >
      <div className='flex flex-col gap-y-2 w-full'>
        <div className='text-left'>
          <h2 className='text-sm font-bold mb-1'>{t('Cookie Preferences')}</h2>
          <p className='text-sm text-muted-foreground'>
            {t('Agora only uses the cookies it needs to keep you logged in and to remember your choices. There is no tracking, no advertising and no support chat.')}
          </p>
        </div>
        <Button
          size='sm'
          onClick={onAccept}
          className='w-full max-w-xs mx-auto justify-center bg-foreground border-none text-background'
        >
          {t('Got it')}
        </Button>
      </div>
    </div>
  )
}
