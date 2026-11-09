/**
 * Agora: one task in a panel on the right (same pattern as the Contacts page).
 * Fields are read-only when the server says the task cannot be edited (task.canEdit),
 * except the status, which any member can move.
 * Props: taskId, meta ({ members, projects }), onClose, onChanged(task), onStatus(task, status),
 *        onDeleted(task), onCommentCount(taskId, n)
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { X, Trash2 } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { cn } from 'util/index'
import { tasksApi } from './api'
import Avatars from './Avatars'

const fieldClasses = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70'

function Field ({ label, htmlFor, children }) {
  return (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={htmlFor} className='text-muted-foreground'>{label}</Label>
      {children}
    </div>
  )
}

export default function TaskSidePanel ({ taskId, listTask, meta, onClose, onChanged, onStatus, onDeleted, onCommentCount }) {
  const { t } = useTranslation()
  const [task, setTask] = useState(null)
  const [comments, setComments] = useState([])
  const [error, setError] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const show = useCallback(next => { setTask(next); setTitle(next.title); setDescription(next.description || '') }, [])

  useEffect(() => {
    let cancelled = false
    setTask(null); setError(null); setComments([])
    tasksApi('/' + taskId)
      .then(data => { if (!cancelled) { show(data.task); setComments(data.comments || []) } })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [taskId, show])

  const save = async patch => {
    setError(null)
    try {
      const data = await tasksApi(`/${taskId}/update`, patch)
      show(data.task)
      onChanged(data.task)
    } catch (e) {
      setError(e.message)
      if (task) { setTitle(task.title); setDescription(task.description || '') }
    }
  }

  const changeStatus = status => {
    if (status !== current.status) onStatus(current, status)
  }

  const toggleAssignee = id => {
    const ids = current.assignees.map(a => String(a.id))
    const next = ids.includes(String(id)) ? ids.filter(x => x !== String(id)) : [...ids, String(id)]
    save({ assigneeIds: next })
  }

  const addComment = async e => {
    e.preventDefault()
    const text = comment.trim()
    if (!text) return
    setBusy(true)
    try {
      const data = await tasksApi(`/${taskId}/comments`, { text })
      const next = [...comments, data.comment]
      setComments(next)
      setComment('')
      onCommentCount(taskId, next.length)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  const removeComment = async id => {
    try {
      await tasksApi(`/comments/${id}/delete`, {})
      const next = comments.filter(c => c.id !== id)
      setComments(next)
      onCommentCount(taskId, next.length)
    } catch (err) { setError(err.message) }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await tasksApi(`/${taskId}/delete`, {})
      onDeleted(task)
    } catch (err) { setError(err.message); setBusy(false) }
  }

  // the list is the truth for status and the other list fields (it follows drags, and rolls back failed moves)
  const current = task && listTask
    ? { ...task, status: listTask.status, position: listTask.position, assignees: listTask.assignees, dueDate: listTask.dueDate, projectId: listTask.projectId }
    : task
  const editable = !!task?.canEdit
  const members = meta?.members || []
  const projects = meta?.projects || []

  return (
    <aside className='bg-card border border-border rounded-lg p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto' aria-label={t('Task')}>
      <div className='flex justify-end'>
        <Button type='button' variant='ghost' size='icon' onClick={onClose} aria-label={t('Close')}><X className='w-4 h-4' /></Button>
      </div>
      {error && <p role='alert' className='m-0 mb-2 text-sm text-destructive'>{error}</p>}
      {!task && !error && <p className='m-0 text-muted-foreground'>{t('Loading…')}</p>}
      {task && (
        <div className='flex flex-col gap-4'>
          <Field label={t('Title')} htmlFor='task-title'>
            <Input id='task-title' value={title} disabled={!editable} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title.trim() !== task.title) save({ title: title.trim() }); else setTitle(task.title) }} maxLength={200} />
          </Field>
          <Field label={t('Status')} htmlFor='task-status'>
            <select id='task-status' className={fieldClasses} value={current.status} onChange={e => changeStatus(e.target.value)}>
              <option value='todo'>{t('To do')}</option>
              <option value='doing'>{t('Doing')}</option>
              <option value='done'>{t('Done')}</option>
            </select>
          </Field>
          <Field label={t('Description')} htmlFor='task-description'>
            <textarea id='task-description' className={cn(fieldClasses, 'h-auto min-h-24')} value={description} disabled={!editable} onChange={e => setDescription(e.target.value)} onBlur={() => { if (description !== (task.description || '')) save({ description }) }} />
          </Field>
          <Field label={t('People')}>
            {editable
              ? (
                <ul className='m-0 p-0 list-none max-h-40 overflow-y-auto flex flex-col gap-1'>
                  {members.map(m => (
                    <li key={m.id}>
                      <label className='inline-flex items-center gap-2 text-sm text-foreground'>
                        <input type='checkbox' checked={task.assignees.some(a => String(a.id) === String(m.id))} onChange={() => toggleAssignee(m.id)} /> {m.name}
                      </label>
                    </li>
                  ))}
                </ul>
                )
              : (task.assignees.length ? <div className='flex items-center gap-2 text-sm text-foreground'><Avatars people={task.assignees} /> {task.assignees.map(a => a.name).join(', ')}</div> : <span className='text-sm text-muted-foreground'>—</span>)}
          </Field>
          <Field label={t('Due date')} htmlFor='task-due'>
            <div className='flex gap-2'>
              <Input id='task-due' type='date' value={task.dueDate || ''} disabled={!editable} onChange={e => save({ dueDate: e.target.value || null })} />
              {editable && task.dueDate && <Button type='button' variant='outline' onClick={() => save({ dueDate: null })}>{t('Clear')}</Button>}
            </div>
          </Field>
          <Field label={t('Project')} htmlFor='task-project'>
            <select id='task-project' className={fieldClasses} value={task.projectId || ''} disabled={!editable} onChange={e => save({ projectId: e.target.value || null })}>
              <option value=''>{t('No project')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {task.source?.kind === 'minutes' && (
            <p className='m-0 text-sm text-muted-foreground'>
              {t('From the minutes of')} <Link to={`/post/${task.source.minutesPostId}`} className='underline text-foreground'>{t('the meeting')}</Link>
            </p>
          )}
          <section aria-label={t('Comments')} className='flex flex-col gap-2'>
            <h3 className='m-0 text-sm font-semibold text-foreground'>{t('Comments')}</h3>
            {comments.length === 0 && <p className='m-0 text-sm text-muted-foreground'>{t('No comments yet.')}</p>}
            <ul className='m-0 p-0 list-none flex flex-col gap-2'>
              {comments.map(c => (
                <li key={c.id} className='text-sm'>
                  <span className='font-semibold text-foreground'>{c.user.name}</span>{' '}
                  <span className='text-xs text-muted-foreground'>{new Date(c.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <p className='m-0 whitespace-pre-wrap text-foreground'>{c.text}</p>
                  {c.canDelete && <button type='button' className='text-xs text-muted-foreground underline' onClick={() => removeComment(c.id)}>{t('Delete comment')}</button>}
                </li>
              ))}
            </ul>
            <form onSubmit={addComment} className='flex gap-2'>
              <Input value={comment} onChange={e => setComment(e.target.value)} placeholder={t('Write a comment…')} aria-label={t('Write a comment')} />
              <Button type='submit' disabled={busy || !comment.trim()}>{t('Comment')}</Button>
            </form>
          </section>
          {editable && (
            <Button type='button' variant='ghost' className='text-destructive self-start' disabled={busy} onClick={remove}>
              <Trash2 className='w-4 h-4 mr-1' />{t('Delete task')}
            </Button>
          )}
        </div>
      )}
    </aside>
  )
}
