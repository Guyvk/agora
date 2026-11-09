/**
 * Agora: the "Action points" box under a minutes post. Each action point of the meeting is a
 * SUGGESTED task: nothing lands on anyone's list until the person named, the host of the
 * meeting or a steward adds it ("Add as task") or says it is no task ("Not a task"). The host
 * and stewards also get "Add all". People, due date and project can be changed before adding.
 * Added rows show "Task added", a link to the task on the circle's Tasks page and whether
 * it is done. Hidden when the post is not a minutes post, has no action points or the
 * viewer is not in the circle. Server part: /noo/agora/tasks/api/suggestions.
 * Props: postId
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Button from 'components/ui/button'
import { circleTasksUrl, formatDay, tasksApi } from './api'
import Avatars from './Avatars'

const fieldClasses = 'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** People chips with a remove button and an "Add person" list. */
function PeoplePicker ({ ids, members, onChange, label }) {
  const { t } = useTranslation()
  const byId = Object.fromEntries(members.map(m => [String(m.id), m]))
  const free = members.filter(m => !ids.includes(String(m.id)))
  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      {ids.map(id => (
        <span key={id} className='inline-flex items-center gap-1 rounded-full bg-selected px-2 py-0.5 text-xs text-foreground'>
          {byId[id] ? byId[id].name : id}
          <button type='button' aria-label={t('Remove {{name}}', { name: byId[id] ? byId[id].name : id })} onClick={() => onChange(ids.filter(x => x !== id))}>×</button>
        </span>
      ))}
      {free.length > 0 && (
        <select className={fieldClasses} aria-label={label} value='' onChange={e => e.target.value && onChange([...ids, e.target.value])}>
          <option value=''>{t('Add a person')}</option>
          {free.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
      )}
    </span>
  )
}

function Row ({ s, meta, busy, onAdd, onDismiss }) {
  const { t } = useTranslation()
  const [ids, setIds] = useState(() => s.people.filter(p => p.status !== 'declined').map(p => String(p.id)))
  const [due, setDue] = useState(s.dueDate || '')
  const [projectId, setProjectId] = useState(s.projectId ? String(s.projectId) : '')
  const open = s.status === 'open'
  const taskLink = s.taskId ? circleTasksUrl(s.groupSlug, s.taskId) : null
  return (
    <li className='rounded-md border border-border bg-card p-3 flex flex-col gap-2' data-testid='action-point' data-suggestion-id={s.id}>
      <p className='m-0 font-semibold text-foreground break-words'>{s.what}</p>
      {open && s.canDecide
        ? (
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <PeoplePicker ids={ids} members={meta ? meta.members : []} onChange={setIds} label={t('Add a person to {{what}}', { what: s.what })} />
            <input type='date' className={fieldClasses} aria-label={t('Due date')} value={due} onChange={e => setDue(e.target.value)} />
            <select className={fieldClasses} aria-label={t('Project')} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value=''>{t('No project')}</option>
              {(meta ? meta.projects : []).map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>
          )
        : (
          <p className='m-0 flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
            <Avatars people={s.people.filter(p => p.status !== 'declined')} max={4} />
            <span>{s.people.filter(p => p.status !== 'declined').map(p => p.name).join(', ') || s.whoText || t('Nobody yet')}</span>
            {s.dueDate && <span>{formatDay(s.dueDate)}</span>}
            {s.projectName && <span>{s.projectName}</span>}
          </p>
          )}
      {open && s.canDecide && (
        <div className='flex flex-wrap gap-2'>
          <Button type='button' disabled={busy} onClick={() => onAdd(s, { assigneeIds: ids, dueDate: due, projectId })}>{t('Add as task')}</Button>
          <Button type='button' variant='outline' disabled={busy} onClick={() => onDismiss(s)}>{t('Not a task')}</Button>
        </div>
      )}
      {open && !s.canDecide && <p className='m-0 text-xs text-muted-foreground'>{t('Waiting for a decision')}</p>}
      {s.status === 'accepted' && (
        <p className='m-0 text-sm text-foreground' data-testid='task-added'>
          {t('Task added')}
          {taskLink && <> {' - '}<Link to={taskLink} className='underline'>{t('Open the task')}</Link></>}
          {' '}<span className='text-muted-foreground'>({s.taskStatus === 'done' ? t('done') : t('not done yet')})</span>
        </p>
      )}
      {s.status === 'dismissed' && <p className='m-0 text-sm text-muted-foreground'>{t('Not a task')}</p>}
    </li>
  )
}

export default function MinutesActionPoints ({ postId }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setData(null); setMeta(null)
    tasksApi(`/suggestions?minutesPostId=${encodeURIComponent(postId)}`)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [postId])

  const groupId = data && data.suggestions.length ? data.suggestions[0].groupId : null
  const decides = data && data.suggestions.some(s => s.canDecide)
  useEffect(() => {
    if (!groupId || !decides) return undefined
    let cancelled = false
    tasksApi(`/meta?groupId=${encodeURIComponent(groupId)}`).then(m => { if (!cancelled) setMeta(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [groupId, decides])

  if (!data || !data.isMinutes || !data.suggestions.length) return null

  const replace = suggestion => setData(d => ({ ...d, suggestions: d.suggestions.map(x => x.id === suggestion.id ? suggestion : x) }))

  const run = async fn => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const add = (s, edits) => run(async () => {
    const body = { assigneeIds: edits.assigneeIds, dueDate: edits.dueDate || null, projectId: edits.projectId || null }
    replace((await tasksApi(`/suggestions/${s.id}/accept`, body)).suggestion)
  })
  const dismiss = s => run(async () => { replace((await tasksApi(`/suggestions/${s.id}/dismiss`, {})).suggestion) })
  const addAll = () => run(async () => {
    const res = await tasksApi('/suggestions/accept-all', { minutesPostId: postId })
    res.suggestions.forEach(replace)
  })

  const canAddAll = data.canAcceptAll && data.suggestions.some(s => s.status === 'open' && s.people.some(p => p.status !== 'declined'))
  return (
    <section data-testid='action-points' aria-label={t('Action points')} className='mt-4 rounded-lg border border-border bg-card p-4 flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='m-0 text-lg font-semibold text-foreground'>{t('Action points')}</h2>
        {canAddAll && <Button type='button' variant='outline' disabled={busy} onClick={addAll}>{t('Add all')}</Button>}
      </div>
      <p className='m-0 text-sm text-muted-foreground'>{t('These are suggestions. Nothing is added to anyone\'s list until the person, the host or a steward says yes.')}</p>
      {error && <p role='alert' className='m-0 text-sm text-destructive'>{error}</p>}
      <ul className='list-none p-0 m-0 flex flex-col gap-2'>
        {data.suggestions.map(s => <Row key={s.id} s={s} meta={meta} busy={busy} onAdd={add} onDismiss={dismiss} />)}
      </ul>
    </section>
  )
}
