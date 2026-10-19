/**
 * Agora: four small welcome steps for a new member, shown at the top of the
 * page until they are all done or the person closes them:
 *
 *   1. Fill in your profile (done when the profile has a line about you or a bio)
 *   2. Open your circle (done once any circle has been opened)
 *   3. Read the guide (done once /guide has been opened)
 *   4. Say hi in your circle (done once the link to the circle's chat is used)
 *
 * Closing them is remembered with the account (see useAgoraSeen.js), so they
 * do not come back on another device.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { isSandboxMode } from 'sandbox/isSandbox'
import { cn } from 'util/index'
import useAgoraSeen, { WELCOME_DISMISSED, GUIDE_READ, SAID_HI } from './useAgoraSeen'
import useMyCircle from './useMyCircle'
import { GUIDE_URL } from './guideUrl'

// Pages where a banner on top would be in the way
export function hideWelcomeStepsOn (pathname) {
  const path = String(pathname || '')
  return path.startsWith('/welcome') ||
    path.startsWith('/messages') ||
    path.startsWith('/create-group') ||
    /\/(map|welcome|settings)(\/|$)/.test(path)
}

function Step ({ done, to, onClick, children }) {
  const Icon = done ? CheckCircle2 : Circle
  const content = (
    <>
      <Icon className={cn('w-4 h-4 shrink-0', done ? 'text-green-600' : 'text-foreground/40')} aria-hidden='true' />
      <span className={cn(done && 'line-through text-foreground/60')}>{children}</span>
    </>
  )
  return (
    <li data-testid='welcome-step' data-done={done ? 'true' : 'false'}>
      {to && !done
        ? <Link to={to} onClick={onClick} className='flex items-center gap-2 text-sm text-foreground hover:text-accent hover:underline'>{content}</Link>
        : <span className='flex items-center gap-2 text-sm text-foreground'>{content}</span>}
    </li>
  )
}

export default function WelcomeSteps () {
  const { t } = useTranslation()
  const location = useLocation()
  const { me, hasSeen, markSeen } = useAgoraSeen()
  const circle = useMyCircle()

  if (!me || isSandboxMode()) return null
  if (me.settings && me.settings.signupInProgress) return null
  if (hasSeen(WELCOME_DISMISSED)) return null
  if (hideWelcomeStepsOn(location.pathname)) return null

  const steps = [
    {
      key: 'profile',
      done: Boolean((me.tagline && me.tagline.trim()) || (me.bio && me.bio.trim())),
      to: '/my/edit-profile',
      label: t('Fill in your profile')
    },
    circle
      ? { key: 'circle', done: circle.opened, to: `/groups/${circle.slug}`, label: t('Open your circle, {{name}}', { name: circle.name }) }
      : { key: 'circle', done: false, to: null, label: t('Join a circle: ask a steward for an invitation') },
    {
      key: 'guide',
      done: hasSeen(GUIDE_READ),
      to: GUIDE_URL,
      label: t('Read the Agora guide')
    },
    {
      key: 'hi',
      done: hasSeen(SAID_HI),
      to: circle ? `/groups/${circle.slug}/chat` : null,
      onClick: () => markSeen(SAID_HI),
      label: t('Say hi in your circle')
    }
  ]

  const doneCount = steps.filter(s => s.done).length
  if (doneCount === steps.length) return null

  return (
    <aside aria-labelledby='agora-welcome-title' className='px-4 pt-3 w-full' data-testid='agora-welcome-steps'>
      <div className='w-full max-w-[750px] mx-auto bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-2 shadow-sm'>
        <div className='flex items-start gap-2'>
          <h2 id='agora-welcome-title' className='text-base font-semibold text-foreground flex-1 min-w-0'>
            {t('Welcome to Agora, {{firstName}}', { firstName: (me.name || '').split(' ')[0] })}
            <span className='ml-2 text-sm font-normal text-foreground/60'>{t('{{done}} of {{total}} done', { done: doneCount, total: steps.length })}</span>
          </h2>
          <button
            type='button'
            onClick={() => markSeen(WELCOME_DISMISSED)}
            className='shrink-0 rounded p-1 text-foreground/60 hover:text-foreground hover:bg-foreground/10'
            aria-label={t('Close the welcome steps')}
            title={t('Close the welcome steps')}
          >
            <X className='w-4 h-4' />
          </button>
        </div>
        <ol className='grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5'>
          {steps.map(s => <Step key={s.key} done={s.done} to={s.to} onClick={s.onClick}>{s.label}</Step>)}
        </ol>
      </div>
    </aside>
  )
}
