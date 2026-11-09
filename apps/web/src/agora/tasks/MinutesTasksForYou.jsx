/**
 * Agora: "From the minutes, for you" at the top of My tasks: action points of meeting minutes
 * that name me and that I have not decided about yet. "Add to my tasks" makes the task with me
 * on it; "Not mine" takes me off the action point (the host and stewards can still decide
 * about it). Hidden when there is nothing. Server part: /noo/agora/tasks/api/suggestions/mine.
 * Props: onAdded(task), optional: called when a task was made, so the page can list it.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Button from 'components/ui/button'
import { formatDay, tasksApi } from './api'

export default function MinutesTasksForYou ({ onAdded }) {
  const { t } = useTranslation()
  const [list, setList] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    tasksApi('/suggestions/mine').then(d => { if (!cancelled) setList(d.suggestions) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!list.length) return null

  const remove = id => setList(l => l.filter(x => x.id !== id))
  const run = async (s, fn) => {
    setBusyId(s.id); setError(null)
    try { await fn() } catch (e) { setError(e.message) } finally { setBusyId(null) }
  }
  // Adding from here always puts me on the task (the server marks which person is me)
  const add = s => run(s, async () => {
    const mine = s.people.find(p => p.me)
    const res = await tasksApi(`/suggestions/${s.id}/accept`, { assigneeIds: [mine.id] })
    remove(s.id)
    if (onAdded) onAdded(res.task)
  })
  const notMine = s => run(s, async () => { await tasksApi(`/suggestions/${s.id}/not-mine`, {}); remove(s.id) })

  return (
    <section data-testid='minutes-for-you' aria-label={t('From the minutes, for you')} className='rounded-lg border border-border bg-card p-4 flex flex-col gap-2'>
      <h2 className='m-0 text-base font-semibold text-foreground'>{t('From the minutes, for you')} <span className='font-normal text-muted-foreground'>{list.length}</span></h2>
      {error && <p role='alert' className='m-0 text-sm text-destructive'>{error}</p>}
      <ul className='list-none p-0 m-0 flex flex-col gap-2'>
        {list.map(s => (
          <li key={s.id} className='flex flex-wrap items-start justify-between gap-2 rounded-md border border-border px-3 py-2' data-testid='minutes-for-you-row'>
            <div className='min-w-0'>
              <p className='m-0 font-semibold text-foreground break-words'>{s.what}</p>
              <p className='m-0 text-xs text-muted-foreground'>
                <Link to={`/post/${s.minutesPostId}`} className='underline'>{s.meeting.title || t('the meeting')}</Link>
                {s.meeting.date && <> {' - '}{formatDay(s.meeting.date)}</>}
                {s.dueDate && <> {' - '}{t('Due')} {formatDay(s.dueDate)}</>}
              </p>
            </div>
            <div className='flex gap-2'>
              <Button type='button' disabled={busyId === s.id} onClick={() => add(s)}>{t('Add to my tasks')}</Button>
              <Button type='button' variant='outline' disabled={busyId === s.id} onClick={() => notMine(s)}>{t('Not mine')}</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
