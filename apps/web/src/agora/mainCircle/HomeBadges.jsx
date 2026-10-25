import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import MainCircleMark from './MainCircleMark'
import useMainCircle, { ACCENT_BG, isActiveChildOfMain, isMainCircleGroup } from './mainCircle'

/**
 * Agora: in a circle's header. In the main circle: a band "7BP Home". In an
 * active child circle: a small "Part of 7BP" link to the main circle's home.
 * Nowhere else (circles that are not active children get nothing).
 */
export default function HomeBadge ({ group, compact = false }) {
  const { t } = useTranslation()
  const mainCircle = useMainCircle()
  if (!group || !mainCircle || compact) return null
  if (isMainCircleGroup(mainCircle, group)) {
    return (
      <span
        data-testid='agora-home-band'
        className={`inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-0.5 mb-1 text-xs font-bold text-white shadow-md ${ACCENT_BG}`}
      >
        <MainCircleMark className='h-3.5' />
        {t('7BP Home')}
      </span>
    )
  }
  if (isActiveChildOfMain(mainCircle, group)) {
    return (
      <Link
        data-testid='agora-part-of'
        to={`/groups/${mainCircle.slug}`}
        className='inline-flex items-center gap-1 self-start rounded-full bg-darkening/30 backdrop-blur-sm border border-white/30 px-2 py-0 mb-1 text-[11px] font-semibold text-white hover:text-white hover:bg-darkening/50 no-underline hover:no-underline transition-colors'
      >
        <MainCircleMark className='h-3' />
        {t('Part of {{name}}', { name: mainCircle.name })}
      </Link>
    )
  }
  return null
}

/** The accent strip along the bottom of the main circle's header. */
export function HomeHeaderAccent ({ group }) {
  const mainCircle = useMainCircle()
  if (!isMainCircleGroup(mainCircle, group)) return null
  return (
    <>
      <div aria-hidden='true' className={`absolute inset-0 z-10 opacity-30 pointer-events-none ${ACCENT_BG}`} />
      <div aria-hidden='true' data-testid='agora-home-accent' className={`absolute inset-x-0 bottom-0 h-1.5 z-30 ${ACCENT_BG}`} />
    </>
  )
}
