import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import MainCircleMark from './MainCircleMark'
import useMainCircle, { ACCENT_BG, ACCENT_TEXT, isMainCircleGroup } from './mainCircle'

/**
 * Agora: "Every circle in 7BP", a card per active child circle, on the welcome
 * page of the main circle only. Each card opens the circle inside the app.
 */
export default function MainCircleCards ({ group }) {
  const { t } = useTranslation()
  const mainCircle = useMainCircle()
  if (!isMainCircleGroup(mainCircle, group)) return null
  const circles = mainCircle.circles || []
  if (circles.length === 0) return null
  return (
    <section data-testid='agora-circle-cards' className='mt-8'>
      <h2 className={`text-xl font-bold mb-3 flex items-center gap-2 ${ACCENT_TEXT}`}>
        {t('Every circle in {{name}}', { name: mainCircle.name })}
      </h2>
      <ul className='grid gap-3 sm:grid-cols-2 list-none p-0 m-0'>
        {circles.map(circle => (
          <li key={circle.id}>
            <Link
              to={`/groups/${circle.slug}`}
              className='flex items-center gap-3 rounded-lg border-2 border-foreground/10 bg-card p-3 no-underline hover:no-underline hover:border-foreground/30 transition-colors'
            >
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-cover bg-center ${ACCENT_BG}`}
                style={circle.avatarUrl ? { backgroundImage: `url(${circle.avatarUrl})` } : {}}
              >
                {!circle.avatarUrl && <MainCircleMark className='h-7' />}
              </span>
              <span className='flex min-w-0 flex-col'>
                <span className='truncate font-bold text-foreground'>{circle.name}</span>
                <span className='text-sm text-foreground/70'>{t('{{count}} Members', { count: circle.memberCount })}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
