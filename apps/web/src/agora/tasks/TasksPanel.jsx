/**
 * Agora: the Tasks part of a project's page. Board or List (one toggle), a side panel for one
 * task, add / move / delete with Undo. Props: projectId (the project post's id).
 * TaskBoard and TaskList take plain props so a circle-wide page and "My tasks" can reuse them.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import getMe from 'store/selectors/getMe'
import Button from 'components/ui/button'
import { cn } from 'util/index'
import { column, positionAt, tasksApi, today } from './api'
import TaskBoard from './TaskBoard'
import TaskList from './TaskList'
import TaskSidePanel from './TaskSidePanel'

const UNDO_MS = 8000

export default function TasksPanel ({ projectId }) {
  const { t } = useTranslation()
  const me = useSelector(getMe)
  const [tasks, setTasks] = useState(null)
  const [meta, setMeta] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [notMember, setNotMember] = useState(false)
  const [error, setError] = useState(null)
  const [view, setView] = useState('board')
  const [includeDone, setIncludeDone] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [undos, setUndos] = useState([])
  const undoTimers = useRef({})
  const errorTimer = useRef(null)

  const flash = useCallback(message => {
    setError(message)
    clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(null), 5000)
  }, [])

  useEffect(() => () => { Object.values(undoTimers.current).forEach(clearTimeout); clearTimeout(errorTimer.current) }, [])

  useEffect(() => {
    let cancelled = false
    setLoadError(null); setNotMember(false)
    const query = `?projectId=${encodeURIComponent(projectId)}` + (includeDone ? '&includeDone=1' : '')
    Promise.all([tasksApi('/list' + query), tasksApi(`/meta?projectId=${encodeURIComponent(projectId)}`)])
      .then(([list, m]) => { if (!cancelled) { setTasks(list.tasks); setMeta(m) } })
      .catch(e => { if (!cancelled) { if (e.status === 403 || e.status === 404) setNotMember(true); else setLoadError(e.message) } })
    return () => { cancelled = true }
  }, [projectId, includeDone])

  const replace = task => setTasks(list => list.map(x => x.id === task.id ? task : x))

  const addTask = async (title, status) => {
    try {
      const data = await tasksApi('/create', { projectId, title, status })
      setTasks(list => [...list, data.task])
    } catch (e) { flash(e.message) }
  }

  const moveTask = async (task, status, position) => {
    const before = tasks.find(x => x.id === task.id) || task
    replace({ ...task, status, position })
    try {
      const data = await tasksApi(`/${task.id}/move`, { status, position })
      replace(data.task)
    } catch (e) {
      replace(before)
      flash(e.message)
    }
  }

  const changeStatus = (task, status) => {
    const list = column(tasks, status).filter(x => x.id !== task.id)
    return moveTask(task, status, positionAt(list, list.length))
  }

  const onChanged = task => {
    // moved to another project: it leaves this page
    if (String(task.projectId) !== String(projectId)) { setTasks(list => list.filter(x => x.id !== task.id)); setSelectedId(null) } else replace(task)
  }

  const onDeleted = task => {
    setTasks(list => list.filter(x => x.id !== task.id))
    setSelectedId(null)
    setUndos(list => [...list.filter(x => x.id !== task.id), task])
    clearTimeout(undoTimers.current[task.id])
    undoTimers.current[task.id] = setTimeout(() => setUndos(list => list.filter(x => x.id !== task.id)), UNDO_MS)
  }

  const restore = async task => {
    clearTimeout(undoTimers.current[task.id])
    setUndos(list => list.filter(x => x.id !== task.id))
    try {
      const data = await tasksApi(`/${task.id}/restore`, {})
      setTasks(list => [...list.filter(x => x.id !== task.id), data.task])
    } catch (e) { flash(e.message) }
  }

  const setCommentCount = (id, n) => setTasks(list => list.map(x => x.id === id ? { ...x, commentCount: n } : x))

  const toggle = (key, label) => (
    <button type='button' aria-pressed={view === key} className={cn('px-3 py-1 text-sm rounded-md border', view === key ? 'bg-selected text-foreground border-selected' : 'border-border text-muted-foreground')} onClick={() => setView(key)}>{label}</button>
  )

  const shared = { tasks: tasks || [], today: today(), selectedId, onAdd: addTask, onMove: moveTask, onOpen: setSelectedId }

  return (
    <section className='flex flex-col gap-3 p-2 sm:p-4' aria-label={t('Tasks')}>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='m-0 text-lg font-semibold text-foreground'>{t('Tasks')}</h2>
        <div className='flex gap-1' role='group' aria-label={t('View')}>{toggle('board', t('Board'))}{toggle('list', t('List'))}</div>
      </div>
      {error && <p role='alert' className='m-0 text-sm text-destructive'>{error}</p>}
      {loadError && <p role='alert' className='m-0 text-destructive'>{loadError}</p>}
      {notMember && <p className='m-0 text-sm text-muted-foreground'>{t('Tasks are for members of this circle.')}</p>}
      {!tasks && !loadError && !notMember && <p className='m-0 text-muted-foreground'>{t('Loading…')}</p>}
      {tasks && (
        <div className={cn('grid gap-4 items-start', selectedId ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : 'grid-cols-1')}>
          <div className='min-w-0 flex flex-col gap-3'>
            {tasks.length === 0 && <p className='m-0 text-muted-foreground'>{t('No tasks yet. Add the first one.')}</p>}
            {view === 'board' ? <TaskBoard {...shared} /> : <TaskList {...shared} currentUserId={me?.id} />}
            {!includeDone && <button type='button' className='self-start text-sm underline text-muted-foreground' onClick={() => setIncludeDone(true)}>{t('Show older done')}</button>}
          </div>
          {selectedId && (
            <TaskSidePanel
              key={selectedId}
              taskId={selectedId}
              listTask={tasks.find(x => x.id === selectedId)}
              meta={meta}
              onClose={() => setSelectedId(null)}
              onChanged={onChanged}
              onStatus={changeStatus}
              onDeleted={onDeleted}
              onCommentCount={setCommentCount}
            />
          )}
        </div>
      )}
      {undos.length > 0 && (
        <div className='fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2'>
          {undos.map(task => (
            <div key={task.id} role='status' className='flex items-center gap-3 rounded-md bg-foreground text-background px-4 py-2 text-sm shadow-lg'>
              {t('Task deleted.')}
              <Button type='button' size='sm' variant='secondary' onClick={() => restore(task)} aria-label={t('Undo delete of {{title}}', { title: task.title })}>{t('Undo')}</Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
