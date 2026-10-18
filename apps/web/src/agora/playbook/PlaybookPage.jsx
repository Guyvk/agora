/**
 * Agora: the playbook page of a group, at /groups/<group>/playbook.
 *
 * Every chapter of the group's playbook, in order, with its owner, its
 * status, when it was last changed, a short text and a link (a Google Doc or
 * a post). Stewards of the group add, change and remove chapters here;
 * members only read. The server checks this again for every change, see
 * apps/backend/lib/agora/playbook.js.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useParams } from 'react-router-dom'
import { BookOpen, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { playbookApi, PLAYBOOK_QUERY, CREATE_CHAPTER, UPDATE_CHAPTER, DELETE_CHAPTER } from './api'

const fieldClasses = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// One colour per status, so the list can be read at a glance. The word is always shown too.
const STATUS_CLASSES = {
  not_started: 'border-foreground/20 bg-foreground/5 text-foreground/80',
  draft: 'border-amber-500/40 bg-amber-500/15 text-foreground',
  in_review: 'border-blue-500/40 bg-blue-500/15 text-foreground',
  agreed: 'border-green-500/50 bg-green-500/20 text-foreground'
}

export function useStatusLabels () {
  const { t } = useTranslation()
  return useMemo(() => ({
    not_started: t('Not started'),
    draft: t('Draft'),
    in_review: t('In review'),
    agreed: t('Agreed')
  }), [t])
}

export function StatusLabel ({ status }) {
  const labels = useStatusLabels()
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_CLASSES[status] || STATUS_CLASSES.not_started)}>
      {labels[status] || status}
    </span>
  )
}

function formatDay (iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

function Field ({ label, htmlFor, className, children }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className='text-muted-foreground'>{label}</Label>
      {children}
    </div>
  )
}

function ChapterCard ({ chapter, canEdit, onEdit }) {
  const { t } = useTranslation()
  return (
    <li className='bg-card border border-border rounded-lg p-4 flex flex-col gap-2' data-testid='playbook-chapter'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <h2 className='text-lg font-semibold text-foreground break-words min-w-0'>{chapter.title}</h2>
        <StatusLabel status={chapter.status} />
      </div>
      <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm'>
        <dt className='text-muted-foreground'>{t('Owner')}</dt>
        <dd className='text-foreground break-words'>{chapter.owner ? chapter.owner.name : t('Nobody yet')}</dd>
        <dt className='text-muted-foreground'>{t('Last updated')}</dt>
        <dd className='text-foreground'>
          {chapter.updatedBy
            ? t('{{date}} by {{name}}', { date: formatDay(chapter.updatedAt), name: chapter.updatedBy.name })
            : formatDay(chapter.updatedAt)}
        </dd>
      </dl>
      {chapter.summary && <p className='whitespace-pre-wrap break-words text-foreground'>{chapter.summary}</p>}
      {(chapter.link || canEdit) && (
        <div className='flex flex-wrap items-center gap-2 pt-1'>
          {chapter.link && (
            <a href={chapter.link} target='_blank' rel='noopener noreferrer' className='inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline break-all'>
              <ExternalLink className='w-4 h-4 shrink-0' /> {t('Open the chapter')}
            </a>
          )}
          {canEdit && (
            <Button type='button' variant='outline' size='sm' className='ml-auto' onClick={onEdit} aria-label={t('Edit {{title}}', { title: chapter.title })}>
              <Pencil /> {t('Edit')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function emptyChapter () {
  return { title: '', status: 'not_started', ownerId: '', position: '', summary: '', link: '' }
}

function ChapterForm ({ chapter, playbook, onSaved, onDeleted, onCancel }) {
  const { t } = useTranslation()
  const labels = useStatusLabels()
  const isNew = !chapter
  const [values, setValues] = useState(() => chapter
    ? { title: chapter.title, status: chapter.status, ownerId: chapter.owner ? chapter.owner.id : '', position: String(chapter.position), summary: chapter.summary || '', link: chapter.link || '' }
    : emptyChapter())
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = name => value => setValues(v => ({ ...v, [name]: value }))

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = {
        title: values.title,
        status: values.status,
        ownerId: values.ownerId || null,
        summary: values.summary,
        link: values.link
      }
      if (String(values.position).trim() !== '') data.position = Number(values.position)
      if (isNew) await playbookApi(CREATE_CHAPTER, { groupId: playbook.groupId, data })
      else await playbookApi(UPDATE_CHAPTER, { id: chapter.id, data })
      onSaved()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await playbookApi(DELETE_CHAPTER, { id: chapter.id })
      onDeleted()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const prefix = isNew ? 'chapter-new' : `chapter-${chapter.id}`
  // Members who left the group still show as owner until someone picks another one.
  const ownerMissing = values.ownerId && !playbook.members.some(m => m.id === values.ownerId)

  return (
    <form onSubmit={save} noValidate className='bg-card border border-selected rounded-lg p-4 flex flex-col gap-4' aria-label={isNew ? t('New chapter') : t('Edit {{title}}', { title: chapter.title })}>
      <h2 className='text-lg font-semibold text-foreground break-words'>{isNew ? t('New chapter') : chapter.title}</h2>
      <div className='grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem] gap-3'>
        <Field label={t('Title')} htmlFor={`${prefix}-title`} className='sm:col-span-3'>
          <Input id={`${prefix}-title`} value={values.title} onChange={e => set('title')(e.target.value)} maxLength={200} required autoFocus />
        </Field>
        <Field label={t('Status')} htmlFor={`${prefix}-status`}>
          <select id={`${prefix}-status`} className={fieldClasses} value={values.status} onChange={e => set('status')(e.target.value)}>
            {playbook.statuses.map(s => <option key={s} value={s}>{labels[s] || s}</option>)}
          </select>
        </Field>
        <Field label={t('Owner')} htmlFor={`${prefix}-owner`}>
          <select id={`${prefix}-owner`} className={fieldClasses} value={values.ownerId} onChange={e => set('ownerId')(e.target.value)}>
            <option value=''>{t('Nobody yet')}</option>
            {ownerMissing && <option value={values.ownerId}>{chapter.owner.name}</option>}
            {playbook.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label={t('Order')} htmlFor={`${prefix}-position`}>
          <Input id={`${prefix}-position`} type='number' inputMode='numeric' min={0} max={9999} step={1} value={values.position} onChange={e => set('position')(e.target.value)} placeholder={isNew ? t('Last') : ''} />
        </Field>
        <Field label={t('Short text')} htmlFor={`${prefix}-summary`} className='sm:col-span-3'>
          <textarea id={`${prefix}-summary`} className={cn(fieldClasses, 'min-h-[80px] h-auto')} value={values.summary} onChange={e => set('summary')(e.target.value)} maxLength={2000} placeholder={t('What this chapter is about, or what it still needs')} />
        </Field>
        <Field label={t('Link')} htmlFor={`${prefix}-link`} className='sm:col-span-3'>
          <Input id={`${prefix}-link`} type='url' inputMode='url' value={values.link} onChange={e => set('link')(e.target.value)} maxLength={1000} placeholder={t('For example a Google Doc or a post in Agora')} />
        </Field>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Button type='submit' disabled={busy}>{t('Save')}</Button>
        <Button type='button' variant='outline' onClick={onCancel} disabled={busy}>{t('Cancel')}</Button>
        {error && <span role='alert' className='text-sm text-destructive'>{error}</span>}
        {!isNew && !confirmDelete && (
          <Button type='button' variant='ghost' className='ml-auto text-destructive' onClick={() => setConfirmDelete(true)}>
            <Trash2 /> {t('Remove this chapter')}
          </Button>
        )}
      </div>
      {confirmDelete && (
        <div className='flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground'>
          <span>{t('This removes the chapter from the playbook for good. Sure?')}</span>
          <Button type='button' variant='destructive' size='sm' onClick={remove} disabled={busy}>{t('Yes, remove')}</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => setConfirmDelete(false)}>{t('Keep')}</Button>
        </div>
      )}
    </form>
  )
}

export default function PlaybookPage () {
  const { t } = useTranslation()
  const { groupSlug } = useParams()
  const [playbook, setPlaybook] = useState(undefined)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // a chapter id, 'new', or null

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Playbook'), icon: <BookOpen />, info: '', search: false })
  }, [setHeaderDetails, t])

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await playbookApi(PLAYBOOK_QUERY, { groupSlug })
      setPlaybook(data.agoraPlaybook)
    } catch (e) {
      setError(e.message)
    }
  }, [groupSlug])

  useEffect(() => { setPlaybook(undefined); setEditing(null); load() }, [load])

  const done = async () => {
    await load()
    setEditing(null)
  }

  const counts = useMemo(() => {
    const out = {}
    for (const c of (playbook && playbook.chapters) || []) out[c.status] = (out[c.status] || 0) + 1
    return out
  }, [playbook])

  if (error) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <div className='text-center py-12 bg-destructive/10 rounded-lg border border-destructive/20'>
          <BookOpen className='w-12 h-12 mx-auto mb-4 text-destructive' />
          <p role='alert' className='text-foreground'>{error}</p>
        </div>
      </div>
    )
  }
  if (playbook === undefined) return <Loading />
  if (playbook === null) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <p className='text-center py-12 text-foreground'>{t('The playbook is for members of this group.')}</p>
      </div>
    )
  }

  const { chapters, canEdit } = playbook

  return (
    <div className='p-4 w-full max-w-[750px] mx-auto flex flex-col gap-4'>
      <Helmet>
        <title>{t('Playbook')} | {playbook.groupName || ''} | Agora</title>
      </Helmet>
      <p className='text-foreground/80'>
        {canEdit
          ? t('Every chapter of the playbook, who owns it and where it stands. As a steward you can add and change chapters.')
          : t('Every chapter of the playbook, who owns it and where it stands. The stewards of this group keep it up to date.')}
      </p>

      {(chapters.length > 0 || canEdit) && (
        <div className='flex flex-wrap items-center gap-2'>
          {playbook.statuses.filter(s => counts[s]).map(s => (
            <span key={s} className='text-sm text-foreground/80'>
              <StatusLabel status={s} /> {counts[s]}
            </span>
          ))}
          {canEdit && editing !== 'new' && (
            <Button size='sm' className='ml-auto' onClick={() => setEditing('new')}><Plus /> {t('Add a chapter')}</Button>
          )}
        </div>
      )}

      {editing === 'new' && (
        <ChapterForm playbook={playbook} onSaved={done} onDeleted={done} onCancel={() => setEditing(null)} />
      )}

      {chapters.length === 0 && editing !== 'new' && (
        <p className='bg-card border border-border rounded-lg p-4 text-muted-foreground'>
          {canEdit ? t('The playbook has no chapters yet. Add the first one.') : t('The playbook has no chapters yet.')}
        </p>
      )}

      <ol className='flex flex-col gap-3' aria-label={t('Chapters')}>
        {chapters.map(chapter => editing === chapter.id
          ? <li key={chapter.id}><ChapterForm chapter={chapter} playbook={playbook} onSaved={done} onDeleted={done} onCancel={() => setEditing(null)} /></li>
          : <ChapterCard key={chapter.id} chapter={chapter} canEdit={canEdit} onEdit={() => setEditing(chapter.id)} />)}
      </ol>
    </div>
  )
}
