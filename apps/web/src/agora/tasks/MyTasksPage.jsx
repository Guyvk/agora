/**
 * Agora: My tasks, at /my-tasks: every task assigned to me in every circle I am in, in
 * sections (Overdue, This week, Later, No date, Done in the last 14 days). Ticking a task
 * moves it to Done, with a few seconds of Undo that moves it back. A click on a row opens the
 * same side panel as the circle's Tasks page. Server part: GET /noo/agora/tasks/api/mine.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { Link } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { postUrl } from '@hylo/navigation'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { addDays, circleTasksUrl, formatDay, isOverdue, positionAt, tasksApi, today } from './api'
import MinutesTasksForYou from './MinutesTasksForYou'
import TaskSidePanel from './TaskSidePanel'
import UndoToasts from './UndoToasts'
import { UNDO_MS } from './useTasks'

/** Splits my tasks into the page's sections (done tasks only in the last one). */
export function sections (tasks, todayString = today()) {
  const weekEnd = addDays(todayString, 7)
  const byDue = (a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.position - b.position
  const open = tasks.filter(x => x.status !== 'done')
  const out = {
    overdue: open.filter(x => isOverdue(x, todayString)).sort(byDue),
    week: open.filter(x => x.dueDate && x.dueDate >= todayString && x.dueDate <= weekEnd).sort(byDue),
    later: open.filter(x => x.dueDate && x.dueDate > weekEnd).sort(byDue),
    none: open.filter(x => !x.dueDate).sort((a, b) => a.position - b.position),
    done: tasks.filter(x => x.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
  }
  return out
}

function Row ({ task, todayString, selected, onTick, onOpen }) {
  const { t } = useTranslation()
  const overdue = isOverdue(task, todayString)
  const done = task.status === 'done'
  const projectTo = task.projectId ? postUrl(task.projectId, { context: 'groups', groupSlug: task.groupSlug }) : null
  return (
    <li className={cn('flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2', { 'border-accent': selected })} data-testid='my-task-row' data-task-id={task.id}>
      <input type='checkbox' className='mt-1' checked={done} onChange={() => onTick(task)} aria-label={done ? t('Mark {{title}} as to do again', { title: task.title }) : t('Mark {{title}} as done', { title: task.title })} />
      <div className='flex-1 min-w-0'>
        <button type='button' className={cn('block text-left font-semibold text-foreground break-words', { 'line-through opacity-70': done })} onClick={() => onOpen(task.id)}>{task.title}</button>
        <p className='m-0 text-xs text-muted-foreground'>
          <Link to={circleTasksUrl(task.groupSlug)} className='underline'>{task.groupName}</Link>
          {projectTo && task.projectName && <> {' / '}<Link to={projectTo} className='underline'>{task.projectName}</Link></>}
        </p>
      </div>
      {task.dueDate && (
        <span className={cn('text-xs shrink-0', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')} data-overdue={overdue ? 'true' : undefined}>
          {overdue && <span className='sr-only'>{t('Overdue')}: </span>}{formatDay(task.dueDate)}
        </span>
      )}
    </li>
  )
}

export default function MyTasksPage () {
  const { t } = useTranslation()
  const { setHeaderDetails } = useViewHeader()
  useEffect(() => { setHeaderDetails({ title: t('My tasks'), icon: <ListChecks />, info: '', search: false }) }, [setHeaderDetails, t])

  const [tasks, setTasks] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [metas, setMetas] = useState({})
  const [undos, setUndos] = useState([]) // [{ kind: 'done' | 'reopen' | 'delete', task: the task as it was before }]
  const timers = useRef({})
  const errorTimer = useRef(null)
  const todayString = today()

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); clearTimeout(errorTimer.current) }, [])

  useEffect(() => {
    let cancelled = false
    tasksApi('/mine').then(data => { if (!cancelled) setTasks(data.tasks) }).catch(e => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [])

  const flash = message => {
    setError(message)
    clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(null), 5000)
  }
  const replace = task => setTasks(list => list.map(x => x.id === task.id ? task : x))
  const selected = tasks && tasks.find(x => x.id === selectedId)

  // The side panel needs the members and projects of the task's own circle
  useEffect(() => {
    if (!selected || metas[selected.groupId]) return
    tasksApi(`/meta?groupId=${encodeURIComponent(selected.groupId)}`).then(m => setMetas(all => ({ ...all, [selected.groupId]: m }))).catch(() => {})
  }, [selected, metas])

  const doneEnd = (task, list = tasks) => {
    const column = list.filter(x => x.groupId === task.groupId && x.status === 'done' && x.id !== task.id).sort((a, b) => a.position - b.position)
    return positionAt(column, column.length)
  }

  const move = async (task, status, position) => {
    const before = tasks.find(x => x.id === task.id) || task
    replace({ ...before, status, position, completedAt: status === 'done' ? new Date().toISOString() : null })
    try {
      const data = await tasksApi(`/${task.id}/move`, { status, position })
      replace({ ...before, ...data.task })
      return true
    } catch (e) {
      replace(before)
      flash(e.message)
      return false
    }
  }

  const addUndo = (kind, task) => {
    setUndos(list => [...list.filter(u => u.task.id !== task.id), { kind, task }])
    clearTimeout(timers.current[task.id])
    timers.current[task.id] = setTimeout(() => setUndos(list => list.filter(u => u.task.id !== task.id)), UNDO_MS)
  }

  const tick = async task => {
    if (task.status === 'done') {
      const reopened = await move(task, 'todo', 0)
      if (reopened) addUndo('reopen', task)
      return
    }
    const ok = await move(task, 'done', doneEnd(task))
    if (ok) addUndo('done', task)
  }

  const undo = async ({ kind, task }) => {
    clearTimeout(timers.current[task.id])
    setUndos(list => list.filter(u => u.task.id !== task.id))
    if (kind === 'done' || kind === 'reopen') {
      await move(task, task.status, task.position)
    } else {
      try {
        const data = await tasksApi(`/${task.id}/restore`, {})
        setTasks(list => [...list.filter(x => x.id !== task.id), data.task])
      } catch (e) { flash(e.message) }
    }
  }

  const onDeleted = task => {
    setTasks(list => list.filter(x => x.id !== task.id))
    setSelectedId(null)
    addUndo('delete', task)
  }

  const groups = useMemo(() => (tasks ? sections(tasks, todayString) : null), [tasks, todayString])
  const parts = [
    ['overdue', t('Overdue')],
    ['week', t('This week')],
    ['later', t('Later')],
    ['none', t('No date')],
    ['done', t('Done in the last 14 days')]
  ]

  return (
    <div className='w-full max-w-[1100px] mx-auto p-2 sm:p-4 flex flex-col gap-4'>
      <Helmet><title>{t('My tasks')}</title></Helmet>
      <h1 className='m-0 text-2xl font-semibold text-foreground'>{t('My tasks')}</h1>
      <MinutesTasksForYou onAdded={task => setTasks(list => (list ? [...list.filter(x => x.id !== task.id), task] : list))} />
      {error && <p role='alert' className='m-0 text-sm text-destructive'>{error}</p>}
      {loadError && <p role='alert' className='m-0 text-destructive'>{loadError}</p>}
      {!tasks && !loadError && <Loading />}
      {tasks && (
        <div className={cn('grid gap-4 items-start', selected ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : 'grid-cols-1')}>
          <div className='min-w-0 flex flex-col gap-5'>
            {tasks.length === 0 && <p className='m-0 text-muted-foreground'>{t('No tasks for you yet.')}</p>}
            {parts.map(([key, label]) => groups[key].length > 0 && (
              <section key={key} aria-label={label} data-testid={'my-tasks-' + key} className='flex flex-col gap-2'>
                <h2 className='m-0 text-base font-semibold text-foreground'>{label} <span className='font-normal text-muted-foreground'>{groups[key].length}</span></h2>
                <ul className='list-none p-0 m-0 flex flex-col gap-2'>
                  {groups[key].map(task => <Row key={task.id} task={task} todayString={todayString} selected={selectedId === task.id} onTick={tick} onOpen={setSelectedId} />)}
                </ul>
              </section>
            ))}
          </div>
          {selected && (
            <TaskSidePanel
              key={selected.id}
              taskId={selected.id}
              listTask={selected}
              meta={metas[selected.groupId]}
              onClose={() => setSelectedId(null)}
              onChanged={replace}
              onStatus={(task, status) => move(task, status, status === 'done' ? doneEnd(task) : 0)}
              onDeleted={onDeleted}
              onCommentCount={(id, n) => setTasks(list => list.map(x => x.id === id ? { ...x, commentCount: n } : x))}
            />
          )}
        </div>
      )}
      <UndoToasts items={undos.map(u => u.kind === 'done'
        ? { key: u.task.id, message: t('Marked as done.'), ariaLabel: t('Undo marking {{title}} as done', { title: u.task.title }), onUndo: () => undo(u) }
        : u.kind === 'reopen'
          ? { key: u.task.id, message: t('Moved back to To do.'), ariaLabel: t('Undo moving {{title}} back to To do', { title: u.task.title }), onUndo: () => undo(u) }
          : { key: u.task.id, message: t('Task deleted.'), ariaLabel: t('Undo delete of {{title}}', { title: u.task.title }), onUndo: () => undo(u) })} />
    </div>
  )
}
