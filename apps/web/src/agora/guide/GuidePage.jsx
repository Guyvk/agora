/**
 * Agora: the guide, at /guide.
 *
 * A short page that explains what Agora can do, for new members and testers.
 * It only describes what is really built. Parts that still wait for a key or
 * an account say "Coming soon". The parts and their texts are in
 * guideParts.json, shared with the Guide in the Help window and with Claude
 * in Help. Opening the page ticks "Read the guide" in the
 * welcome steps (see WelcomeSteps.jsx).
 */
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useLocation } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import useAgoraSeen, { GUIDE_READ } from './useAgoraSeen'
import useMyCircle from './useMyCircle'
import { GUIDE_INTRO, GUIDE_PARTS, GuidePartBody } from './guideParts'

function Section ({ id, icon: Icon, title, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className='bg-card border border-border rounded-lg p-4 flex flex-col gap-2 scroll-mt-4' data-testid='guide-section'>
      <h2 id={`${id}-title`} className='flex items-center gap-2 text-lg font-semibold text-foreground'>
        <Icon className='w-5 h-5 shrink-0 text-accent' aria-hidden='true' /> {title}
      </h2>
      <div className='flex flex-col gap-2 text-foreground/90 leading-relaxed'>{children}</div>
    </section>
  )
}

export default function GuidePage () {
  const { t } = useTranslation()
  const { me, markSeen } = useAgoraSeen()
  const circle = useMyCircle()

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Agora guide'), icon: <BookOpen />, info: '', search: false })
  }, [setHeaderDetails, t])

  // Opening the guide counts as reading it, for the welcome steps
  const meId = me && me.id
  useEffect(() => { if (meId) markSeen(GUIDE_READ) }, [meId]) // eslint-disable-line react-hooks/exhaustive-deps

  // An address such as /guide#events (from "Open the full guide" in Help) scrolls to that part
  const { hash } = useLocation()
  useEffect(() => {
    const id = (hash || '').replace('#', '')
    const section = id && document.getElementById(id)
    if (section && section.scrollIntoView) section.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <div className='p-4 w-full max-w-[750px] mx-auto flex flex-col gap-4'>
      <Helmet>
        <title>{t('Agora guide')} | Agora</title>
      </Helmet>

      <p className='text-foreground/80'>{t(GUIDE_INTRO)}</p>

      <nav aria-label={t('On this page')} className='flex flex-wrap gap-2'>
        {GUIDE_PARTS.map(part => (
          <a key={part.id} href={`#${part.id}`} className='rounded-full border border-border bg-card px-3 py-1 text-sm text-foreground hover:border-selected'>
            {t(part.title)}
          </a>
        ))}
      </nav>

      {GUIDE_PARTS.map(part => (
        <Section key={part.id} id={part.id} icon={part.icon} title={t(part.title)}>
          <GuidePartBody part={part} circle={circle} />
        </Section>
      ))}
    </div>
  )
}
