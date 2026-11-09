/**
 * Agora: "Open tasks from last time" on a meeting or event post: the tasks, not yet done, that
 * came from the minutes of the previous meeting of this event (or, when it had none, from the
 * most recent minutes in the circle). Hidden when there are none or the viewer is not in the
 * circle. Server part: /noo/agora/tasks/api/suggestions/last-time. Props: postId
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { circleTasksUrl, formatDay, tasksApi } from './api'
import Avatars from './Avatars'

export default function OpenTasksFromLastTime ({ postId }) {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    let cancelled = false
    setTasks([])
    tasksApi(`/suggestions/last-time?eventPostId=${encodeURIComponent(postId)}`)
      .then(d => { if (!cancelled) setTasks(d.tasks) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [postId])

  if (!tasks.length) return null
  return (
    <section data-testid='open-from-last-time' aria-label={t('Open tasks from last time')} className='mt-4 rounded-lg border border-border bg-card p-4'>
      <h2 className='m-0 mb-2 text-lg font-semibold text-foreground'>{t('Open tasks from last time')}</h2>
      <ul className='list-none p-0 m-0 flex flex-col gap-1.5'>
        {tasks.map(task => (
          <li key={task.id} className='flex items-center justify-between gap-3'>
            <Link to={circleTasksUrl(task.groupSlug, task.id)} className='font-medium text-foreground hover:underline break-words'>{task.title}</Link>
            <span className='flex items-center gap-2 shrink-0 text-xs text-muted-foreground'>
              <Avatars people={task.assignees} max={3} />
              {task.dueDate && formatDay(task.dueDate)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
