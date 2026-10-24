import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { postUrl } from '@hylo/navigation'

/**
 * Agora: "This week in 7BP", the block at the top of the 7BP Home's welcome
 * page (the server part is apps/backend/lib/agora/thisWeek.js). It shows the
 * next meetings and events, the newest announcements, the latest minutes and
 * the recent decisions of all circles the member can see.
 *
 * It asks the server once. The server answers { enabled: false } for every
 * other circle, so on those pages the block shows nothing at all. Every link
 * opens inside the app. Times are shown in the member's own time zone.
 */
export const THIS_WEEK_URL = '/noo/agora/this-week'

async function load (groupSlug) {
  const res = await fetch(`${THIS_WEEK_URL}?group=${encodeURIComponent(groupSlug)}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error('This week could not be loaded')
  return res.json()
}

function whenText (iso, language) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch (e) {
    return new Date(iso).toLocaleString()
  }
}

function dayText (iso, language) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(language, { day: 'numeric', month: 'short' })
  } catch (e) {
    return new Date(iso).toLocaleDateString()
  }
}

function PostLink ({ item }) {
  const to = postUrl(item.id, item.circle ? { context: 'groups', groupSlug: item.circle.slug } : {})
  return <Link to={to} className='font-medium text-foreground hover:underline'>{item.title}</Link>
}

function Part ({ title, empty, items, testId, children }) {
  return (
    <section data-testid={testId} className='min-w-0'>
      <h3 className='text-sm font-bold uppercase tracking-wide text-foreground/60 mb-2'>{title}</h3>
      {items.length === 0
        ? <p className='text-sm text-foreground/60 m-0'>{empty}</p>
        : <ul className='list-none p-0 m-0 flex flex-col gap-2'>{children}</ul>}
    </section>
  )
}

function Circle ({ item }) {
  return item.circle ? <span className='text-foreground/60'>{item.circle.name}</span> : null
}

export default function ThisWeek ({ groupSlug }) {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let stopped = false
    setData(null)
    setFailed(false)
    if (!groupSlug) return undefined
    load(groupSlug)
      .then(body => { if (!stopped) setData(body) })
      .catch(err => {
        console.warn('This week in 7BP could not be loaded', err)
        if (!stopped) setFailed(true)
      })
    return () => { stopped = true }
  }, [groupSlug])

  if (failed || !data || !data.enabled) return null

  const language = i18n.language
  return (
    <div data-testid='agora-this-week' className='mb-6 rounded-lg border border-foreground/10 bg-card p-4 not-prose'>
      <h2 className='text-xl font-bold mt-0 mb-4'>{t('This week in 7BP')}</h2>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
        <Part testId='agora-this-week-meetings' title={t('Next meetings and events')} empty={t('No meetings this week')} items={data.meetings}>
          {data.meetings.map(m => (
            <li key={m.id} className='text-sm'>
              <div className='text-foreground/60'>{whenText(m.startsAt, language)}</div>
              <div><PostLink item={m} /></div>
              <div className='flex flex-wrap gap-x-3'>
                <Circle item={m} />
                {m.roomPath && <a href={m.roomPath} className='text-foreground underline'>{t('Meeting room')}</a>}
              </div>
            </li>
          ))}
        </Part>
        <Part testId='agora-this-week-announcements' title={t('Newest announcements')} empty={t('No announcements yet')} items={data.announcements}>
          {data.announcements.map(a => (
            <li key={a.id} className='text-sm'>
              <div className='text-foreground/60'>{dayText(a.at, language)}</div>
              <div><PostLink item={a} /></div>
              <Circle item={a} />
              {a.summary && <div className='text-foreground/70'>{a.summary}</div>}
            </li>
          ))}
        </Part>
        <Part testId='agora-this-week-minutes' title={t('Latest minutes')} empty={t('No minutes yet')} items={data.minutes}>
          {data.minutes.map(m => (
            <li key={m.id} className='text-sm'>
              <div className='text-foreground/60'>{dayText(m.at, language)}</div>
              <div><PostLink item={m} /></div>
              <Circle item={m} />
            </li>
          ))}
        </Part>
        <Part testId='agora-this-week-decisions' title={t('Recent decisions')} empty={t('No decisions in the last two weeks')} items={data.decisions}>
          {data.decisions.map(d => (
            <li key={d.id} className='text-sm'>
              <div className='text-foreground/60'>{dayText(d.at, language)}</div>
              <div><PostLink item={d} /></div>
              <Circle item={d} />
              {d.outcome && <div className='text-foreground/70'>{t('Outcome: {{outcome}}', { outcome: d.outcome })}</div>}
            </li>
          ))}
        </Part>
      </div>
    </div>
  )
}
