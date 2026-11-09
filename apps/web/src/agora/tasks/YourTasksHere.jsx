/**
 * Agora: the block "Your tasks here" on a circle's home page: the member's open tasks in this
 * circle (at most 5, soonest due first), each opening the circle's Tasks page with that task
 * selected, and a link to My tasks. It shows nothing at all when there are none, when the
 * member is not in the circle, or when the call fails.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { MY_TASKS_URL, circleTasksUrl, formatDay, isOverdue, tasksApi } from './api'
import { cn } from 'util/index'

export const MAX_HERE = 5

export default function YourTasksHere ({ groupId, groupSlug }) {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    let cancelled = false
    setTasks([])
    if (!groupId) return undefined
    tasksApi(`/list?groupId=${encodeURIComponent(groupId)}&mine=1`)
      .then(data => {
        if (cancelled) return
        const open = data.tasks.filter(x => x.status !== 'done')
        open.sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') || a.position - b.position)
        setTasks(open.slice(0, MAX_HERE))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [groupId])

  if (!tasks.length) return null
  return (
    <section data-testid='your-tasks-here' aria-label={t('Your tasks here')} className='mb-6 rounded-lg border border-border bg-card p-4'>
      <h2 className='m-0 mb-2 text-lg font-semibold text-foreground'>{t('Your tasks here')}</h2>
      <ul className='list-none p-0 m-0 flex flex-col gap-1.5'>
        {tasks.map(task => (
          <li key={task.id} className='flex items-baseline justify-between gap-3'>
            <Link to={circleTasksUrl(groupSlug, task.id)} className='font-medium text-foreground hover:underline break-words'>{task.title}</Link>
            {task.dueDate && <span className={cn('text-xs shrink-0', isOverdue(task) ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{formatDay(task.dueDate)}</span>}
          </li>
        ))}
      </ul>
      <Link to={MY_TASKS_URL} className='inline-block mt-3 text-sm underline text-muted-foreground'>{t('All my tasks')}</Link>
    </section>
  )
}
