/**
 * Agora: my calendar, at /calendar.
 *
 * Every Meeting and Event of every circle I am an active member of, and
 * everything marked "for all of 7BP". The server decides what is in it
 * (apps/backend/lib/agora/calendar.js); the calendar feed holds exactly the
 * same. The month, week and day views are Hylo's own calendar
 * (components/Calendar); Meetings have a dashed outline there, Events a solid
 * one. Below it: what is coming up, and the private calendar link to add to
 * Google Calendar, Apple Calendar or Outlook.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { Link } from 'react-router-dom'
import { CalendarDays, Copy, MapPin, NotebookPen, Users } from 'lucide-react'
import Button from 'components/ui/button'
import Calendar from 'components/Calendar'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { calendarApi, MEETING } from './api'

const DAY = 86400000

/** The items of the server, in the shape Hylo's calendar expects of a post. */
export function itemsToPosts (items) {
  return items.map(item => ({
    id: item.id,
    type: 'event',
    agoraKind: item.kind,
    agoraForAll: item.forAll,
    title: item.title,
    startTime: item.start,
    endTime: item.end,
    timezone: item.timezone,
    location: item.location,
    groups: item.groups,
    creator: item.creator,
    details: item.summary || ''
  }))
}

function formatWhen (item) {
  const start = new Date(item.start)
  const end = new Date(item.end)
  const day = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const from = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const to = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${from} - ${to}`
}

export function KindChip ({ kind, forAll }) {
  const { t } = useTranslation()
  const meeting = kind === MEETING
  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-xs font-medium',
          meeting ? 'border-dashed border-foreground/40 bg-foreground/5' : 'border-solid border-selected/60 bg-selected/15'
        )}
        data-testid={`calendar-kind-${kind}`}
      >
        {meeting ? <Users className='w-3 h-3' /> : <CalendarDays className='w-3 h-3' />}
        {meeting ? t('Meeting') : t('Event')}
      </span>
      {forAll && <span className='rounded-full bg-selected/20 px-2 py-0.5 text-xs font-bold'>{t('All of 7BP')}</span>}
    </span>
  )
}

function UpcomingItem ({ item }) {
  const { t } = useTranslation()
  return (
    <li className='bg-card border border-border rounded-lg p-3 flex flex-col gap-1' data-testid='calendar-item'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Link to={`/post/${item.id}`} className='text-base font-semibold text-foreground break-words min-w-0 hover:underline'>{item.title}</Link>
        <KindChip kind={item.kind} forAll={item.forAll} />
      </div>
      <div className='text-sm text-foreground/70'>{formatWhen(item)}</div>
      {item.groups.length > 0 && (
        <div className='text-xs text-foreground/60'>{item.groups.map(g => g.name).join(', ')}</div>
      )}
      {item.roomUrl && (
        <a className='text-sm text-selected inline-flex items-center gap-1 w-fit' href={item.roomUrl} target='_blank' rel='noopener noreferrer'>
          <NotebookPen className='w-4 h-4' />{t('Meet in Agora, with minutes')}
        </a>
      )}
      {item.location && (
        <div className='text-sm text-foreground/70 inline-flex items-center gap-1'><MapPin className='w-4 h-4 shrink-0' />{item.location}</div>
      )}
    </li>
  )
}

function SubscribePanel () {
  const { t } = useTranslation()
  const [feed, setFeed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    calendarApi('/feed').then(r => { if (alive) setFeed(r) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [])

  const run = useCallback(async (path, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      setFeed(await calendarApi(path, {}))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(feed.url)
      setCopied(true)
    } catch (e) {
      setCopied(false)
    }
  }, [feed])

  return (
    <section className='bg-card border border-border rounded-lg p-4 flex flex-col gap-3' aria-labelledby='agora-calendar-subscribe' data-testid='calendar-subscribe'>
      <h2 id='agora-calendar-subscribe' className='text-lg font-semibold text-foreground m-0'>{t('agoraCalendar.subscribeTitle')}</h2>
      <p className='text-sm text-foreground/80 m-0'>{t('agoraCalendar.subscribeIntro')}</p>
      {error && <p role='alert' className='text-sm text-destructive m-0'>{error}</p>}
      {feed === null && !error && <Loading type='inline' />}
      {feed && !feed.url && (
        <Button variant='secondary' disabled={busy} onClick={() => run('/feed/renew')} data-testid='calendar-make-link'>{t('agoraCalendar.makeLink')}</Button>
      )}
      {feed && feed.url && (
        <>
          <div className='flex flex-col sm:flex-row gap-2'>
            <input
              readOnly
              aria-label={t('agoraCalendar.linkLabel')}
              value={feed.url}
              onFocus={e => e.target.select()}
              className='flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground'
              data-testid='calendar-link'
            />
            <Button variant='secondary' onClick={copy} data-testid='calendar-copy'><Copy className='w-4 h-4 mr-1' />{copied ? t('Copied!') : t('Copy')}</Button>
          </div>
          <p className='text-xs text-foreground/70 m-0'>{t('agoraCalendar.secret')}</p>
          <ul className='text-sm text-foreground/80 list-disc pl-5 m-0 flex flex-col gap-1'>
            <li>{t('agoraCalendar.howGoogle')}</li>
            <li>{t('agoraCalendar.howApple')}</li>
            <li>{t('agoraCalendar.howOutlook')}</li>
          </ul>
          <p className='text-xs text-foreground/70 m-0'>{t('agoraCalendar.refresh')}</p>
          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' size='sm' disabled={busy} onClick={() => run('/feed/renew', t('agoraCalendar.confirmRenew'))} data-testid='calendar-renew'>{t('agoraCalendar.renew')}</Button>
            <Button variant='outline' size='sm' disabled={busy} onClick={() => run('/feed/revoke', t('agoraCalendar.confirmRevoke'))} data-testid='calendar-revoke'>{t('agoraCalendar.revoke')}</Button>
          </div>
        </>
      )}
    </section>
  )
}

export default function CalendarPage () {
  const { t } = useTranslation()
  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Calendar'), icon: <CalendarDays />, info: '', search: false })
  }, [setHeaderDetails, t])

  const [date, setDate] = useState(() => new Date())
  const [mode, setMode] = useState('month')
  const [items, setItems] = useState(null)
  const [upcoming, setUpcoming] = useState(null)
  const [error, setError] = useState(null)

  // The month on screen, with a week on either side for the days of the
  // previous and next month that the month view also shows.
  const monthKey = `${date.getFullYear()}-${date.getMonth()}`
  useEffect(() => {
    let alive = true
    const from = new Date(date.getFullYear(), date.getMonth(), 1).getTime() - 7 * DAY
    const to = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() + 7 * DAY
    calendarApi(`/items?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`)
      .then(r => { if (alive) { setItems(r.items || []); setError(null) } })
      .catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [monthKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    const now = Date.now()
    calendarApi(`/items?from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now + 60 * DAY).toISOString())}`)
      .then(r => { if (alive) setUpcoming(r.items || []) })
      .catch(() => { if (alive) setUpcoming([]) })
    return () => { alive = false }
  }, [])

  const posts = useMemo(() => itemsToPosts(items || []), [items])
  const updateCalendarView = useCallback(updates => {
    if (updates.mode !== undefined) setMode(updates.mode)
    if (updates.date !== undefined) setDate(new Date(updates.date))
  }, [])

  return (
    <div className='w-full max-w-[1100px] mx-auto px-4 py-4 flex flex-col gap-4' data-testid='agora-calendar-page'>
      <Helmet><title>{t('Calendar')} | Agora</title></Helmet>
      <div className='flex flex-col gap-1'>
        <p className='text-sm text-foreground/80 m-0'>{t('agoraCalendar.intro')}</p>
        <div className='flex flex-wrap items-center gap-3 text-xs text-foreground/70'>
          <KindChip kind='meeting' /> <span>{t('agoraCalendar.meetingLegend')}</span>
          <KindChip kind='event' /> <span>{t('agoraCalendar.eventLegend')}</span>
        </div>
      </div>
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
      {items === null && !error && <Loading />}
      {items !== null && (
        <div className='calendarView'>
          <Calendar
            posts={posts}
            group={null}
            routeParams={{}}
            querystringParams={{}}
            date={date}
            setDate={d => setDate(new Date(d))}
            mode={mode}
            setMode={setMode}
            updateCalendarView={updateCalendarView}
          />
        </div>
      )}
      <section className='flex flex-col gap-2' aria-labelledby='agora-calendar-upcoming'>
        <h2 id='agora-calendar-upcoming' className='text-lg font-semibold text-foreground m-0'>{t('agoraCalendar.upcoming')}</h2>
        {upcoming === null && <Loading type='inline' />}
        {upcoming && upcoming.length === 0 && <p className='text-sm text-foreground/70 m-0'>{t('agoraCalendar.nothingUpcoming')}</p>}
        {upcoming && upcoming.length > 0 && (
          <ul className='flex flex-col gap-2 p-0 m-0 list-none'>
            {upcoming.map(item => <UpcomingItem key={item.id} item={item} />)}
          </ul>
        )}
      </section>
      <SubscribePanel />
    </div>
  )
}
