/**
 * Agora: the data and the actions behind a tasks page (list, add, move, delete with Undo),
 * shared by the project page (TasksPanel) and the circle page (CircleTasksPage).
 * scope: { projectId } or { groupId }. keepTask(task): false when a changed task no longer
 * belongs on this page (moved to another project, on the project page).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { column, positionAt, tasksApi } from './api'

export const UNDO_MS = 8000

export function scopeQuery (scope) {
  return scope.projectId ? `projectId=${encodeURIComponent(scope.projectId)}` : `groupId=${encodeURIComponent(scope.groupId)}`
}

export default function useTasks ({ scope, keepTask, initialSelectedId = null }) {
  const [tasks, setTasks] = useState(null)
  const [meta, setMeta] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [notMember, setNotMember] = useState(false)
  const [error, setError] = useState(null)
  const [includeDone, setIncludeDone] = useState(false)
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [undos, setUndos] = useState([])
  const undoTimers = useRef({})
  const errorTimer = useRef(null)
  const key = scopeQuery(scope)

  const flash = useCallback(message => {
    setError(message)
    clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(null), 5000)
  }, [])

  useEffect(() => () => { Object.values(undoTimers.current).forEach(clearTimeout); clearTimeout(errorTimer.current) }, [])

  useEffect(() => {
    let cancelled = false
    setLoadError(null); setNotMember(false)
    const query = '?' + key + (includeDone ? '&includeDone=1' : '')
    Promise.all([tasksApi('/list' + query), tasksApi('/meta?' + key)])
      .then(([list, m]) => { if (!cancelled) { setTasks(list.tasks); setMeta(m) } })
      .catch(e => { if (!cancelled) { if (e.status === 403 || e.status === 404) setNotMember(true); else setLoadError(e.message) } })
    return () => { cancelled = true }
  }, [key, includeDone])

  const replace = task => setTasks(list => list.map(x => x.id === task.id ? task : x))

  const addTask = async (title, status, projectId) => {
    try {
      const body = { ...scope, title, status }
      if (!scope.projectId && projectId) body.projectId = projectId
      const data = await tasksApi('/create', body)
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
    if (keepTask && !keepTask(task)) { setTasks(list => list.filter(x => x.id !== task.id)); setSelectedId(null) } else replace(task)
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

  return { tasks, meta, loadError, notMember, error, includeDone, setIncludeDone, selectedId, setSelectedId, undos, addTask, moveTask, changeStatus, onChanged, onDeleted, restore, setCommentCount }
}
