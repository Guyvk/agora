/**
 * Agora: the Help desk, where the people who run Agora work through what
 * members sent from the Help window.
 *
 *   /help-desk              the list, with filters by status and type
 *   /help-desk/<id>         one request: the conversation, its status, an
 *                           internal note, answers to the person, and
 *                           "Build this", which writes a short task for a
 *                           builder without names or personal details
 *
 * Only Help desk admins (AGORA_HELPDESK_ADMINS on the server) get in; the
 * server checks this for every request. See apps/backend/lib/agora/help.js.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams } from 'react-router-dom'
import { Copy, Hammer, LifeBuoy } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { helpApi, helpLabels, formatMoment, HELP_DESK_URL } from './api'
import { fieldClasses } from './HelpWindow'

function Section ({ title, children }) {
  return (
    <section className='flex flex-col gap-2 border-t border-border pt-3'>
      <h3 className='text-sm font-semibold text-foreground m-0'>{title}</h3>
      {children}
    </section>
  )
}

function Detail ({ id, labels, onChanged }) {
  const { t } = useTranslation()
  const [request, setRequest] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [reply, setReply] = useState('')
  const [task, setTask] = useState('')
  const [link, setLink] = useState('')

  const load = useCallback(async () => {
    try {
      setError(null)
      const r = (await helpApi('/desk/' + encodeURIComponent(id))).request
      setRequest(r)
      setStatus(r.status)
      setNote(r.internal_note || '')
      setTask(r.builder_task || '')
      setLink(r.builder_task_link || '')
    } catch (e) {
      setError(e.message)
    }
  }, [id])

  useEffect(() => { setRequest(null); setMessage(null); setReply(''); load() }, [load])

  const run = async (fn, done) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await fn()
      await load()
      onChanged()
      setMessage(result && result.warning ? result.warning : done)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const path = '/desk/' + encodeURIComponent(id)
  const save = () => run(() => helpApi(path + '/update', { status, internal_note: note, builder_task_link: link }), t('Saved'))
  const sendReply = () => run(async () => {
    const result = await helpApi(path + '/reply', { body: reply })
    setReply('')
    return result
  }, t('Your answer was sent.'))
  const build = () => run(() => helpApi(path + '/build', { task }), t('The builder task is stored and the request is marked as being built.'))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(task)
      setMessage(t('Copied'))
    } catch (e) {
      setError(t('Copying did not work. Select the text and copy it yourself.'))
    }
  }

  if (error && !request) return <p role='alert' className='text-destructive'>{error}</p>
  if (!request) return <Loading />

  const canAskClaude = request.claude && request.mode === 'chat'

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <h2 className='text-lg font-semibold text-foreground m-0 break-words'>{request.title}</h2>
        <p className='text-sm text-muted-foreground'>
          {labels.shortTypes[request.type]} · {labels.urgencies[request.urgency]} · {request.mode === 'chat' ? t('Chat with Claude') : t('Plain form')} · {formatMoment(request.created_at)}
        </p>
        {request.person && <p className='text-sm'>{t('From')}: {request.person.name} ({request.person.email})</p>}
      </div>

      <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm'>
        <dt className='text-muted-foreground'>{t('Page')}</dt><dd className='break-all'>{request.page_url || '-'}</dd>
        <dt className='text-muted-foreground'>{t('Browser')}</dt><dd className='break-words'>{request.user_agent || '-'}</dd>
        <dt className='text-muted-foreground'>{t('Screen')}</dt><dd>{request.screen || '-'}</dd>
        <dt className='text-muted-foreground'>{t('Version')}</dt><dd>{request.app_version || '-'}</dd>
      </dl>

      {request.summary && <Section title={t('Summary')}><p className='text-sm whitespace-pre-wrap break-words'>{request.summary}</p></Section>}
      {request.what_happened && <Section title={t('What happened')}><p className='text-sm whitespace-pre-wrap break-words'>{request.what_happened}</p></Section>}
      {request.what_expected && <Section title={t('What they expected')}><p className='text-sm whitespace-pre-wrap break-words'>{request.what_expected}</p></Section>}
      {request.conversation && request.conversation.length > 0 && (
        <Section title={t('The chat')}>
          {request.conversation.map((m, i) => <p key={i} className='text-sm whitespace-pre-wrap break-words'><strong>{m.role === 'claude' ? 'Claude' : t('Member')}:</strong> {m.text}</p>)}
        </Section>
      )}

      <Section title={t('Answers')}>
        {request.replies.length === 0 && <p className='text-sm text-muted-foreground'>{t('No answers yet.')}</p>}
        {request.replies.map(r => (
          <div key={r.id} className={cn('rounded-lg px-3 py-2 text-sm', r.from_desk ? 'bg-accent/10 border border-accent/30' : 'bg-foreground/5')}>
            <p className='text-xs text-muted-foreground'>{r.from_desk ? t('Help desk') : t('Member')}{r.author_name ? ` (${r.author_name})` : ''} · {formatMoment(r.created_at)}</p>
            <p className='whitespace-pre-wrap break-words'>{r.body}</p>
          </div>
        ))}
        <textarea aria-label={t('Answer the person')} placeholder={t('Answer the person. They see it in their Help window and get an email.')} rows={3} className={fieldClasses} value={reply} maxLength={5000} onChange={e => setReply(e.target.value)} />
        <Button size='sm' className='self-start' disabled={busy || !reply.trim()} onClick={sendReply}>{t('Send answer')}</Button>
      </Section>

      <Section title={t('Status and internal note')}>
        <Label htmlFor='agora-desk-status' className='text-muted-foreground'>{t('Status')}</Label>
        <select id='agora-desk-status' className={cn(fieldClasses, 'h-10')} value={status} onChange={e => setStatus(e.target.value)}>
          {Object.keys(labels.statuses).map(s => <option key={s} value={s}>{labels.statuses[s]}</option>)}
        </select>
        <Label htmlFor='agora-desk-note' className='text-muted-foreground'>{t('Internal note (only the Help desk sees it)')}</Label>
        <textarea id='agora-desk-note' rows={3} className={fieldClasses} value={note} maxLength={10000} onChange={e => setNote(e.target.value)} />
        <Label htmlFor='agora-desk-link' className='text-muted-foreground'>{t('Link to the builder task')}</Label>
        <Input id='agora-desk-link' value={link} onChange={e => setLink(e.target.value)} placeholder='https://' />
        <Button size='sm' variant='outline' className='self-start' disabled={busy} onClick={save}>{t('Save')}</Button>
      </Section>

      <Section title={t('Build this')}>
        <p className='text-sm text-muted-foreground'>
          {canAskClaude
            ? t('Leave the box empty and Claude writes a short task without names or personal details. Or type it yourself.')
            : t('Type a short task for a builder: the goal, what happens now, what should happen, where, and when it is done. No names or personal details.')}
        </p>
        <textarea aria-label={t('Builder task')} rows={6} className={fieldClasses} value={task} maxLength={5000} onChange={e => setTask(e.target.value)} />
        <div className='flex flex-wrap gap-2'>
          <Button size='sm' disabled={busy || (!task.trim() && !canAskClaude)} onClick={build}><Hammer /> {task.trim() || !canAskClaude ? t('Build this') : t('Let Claude write it')}</Button>
          <Button size='sm' variant='outline' disabled={!task.trim()} onClick={copy}><Copy /> {t('Copy')}</Button>
        </div>
      </Section>

      {message && <p role='status' className='text-sm text-foreground'>{message}</p>}
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
    </div>
  )
}

export default function HelpDeskPage () {
  const { t } = useTranslation()
  const labels = helpLabels(t)
  const navigate = useNavigate()
  const { requestId } = useParams()
  const [data, setData] = useState(null)
  const [pageError, setPageError] = useState(null)
  const [filters, setFilters] = useState({ status: '', type: '' })

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Help desk'), icon: <LifeBuoy /> })
  }, [setHeaderDetails, t])

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filters.status) params.set('status', filters.status)
    if (filters.type) params.set('type', filters.type)
    try {
      setData(await helpApi('/desk' + (params.toString() ? '?' + params : '')))
    } catch (e) {
      setPageError(e.status === 403 ? t('The Help desk is for the people who run Agora.') : e.message)
    }
  }, [filters, t])

  useEffect(() => { load() }, [load])

  if (pageError) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <div className='text-center py-12 bg-destructive/10 rounded-lg border border-destructive/20'>
          <LifeBuoy className='w-12 h-12 mx-auto mb-4 text-destructive' />
          <p className='text-foreground'>{pageError}</p>
        </div>
      </div>
    )
  }
  if (!data) return <Loading />

  return (
    <div className='p-4 w-full max-w-[1200px] mx-auto flex flex-col gap-4'>
      <Helmet><title>{t('Help desk')} | Agora</title></Helmet>
      <div className='grid grid-cols-2 gap-2 max-w-[600px]'>
        <select aria-label={t('Status')} className={cn(fieldClasses, 'h-10')} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value=''>{t('Every status')}</option>
          {Object.keys(labels.statuses).map(s => <option key={s} value={s}>{labels.statuses[s]} ({data.counts[s] || 0})</option>)}
        </select>
        <select aria-label={t('Type')} className={cn(fieldClasses, 'h-10')} value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
          <option value=''>{t('Every type')}</option>
          {Object.keys(labels.shortTypes).map(type => <option key={type} value={type}>{labels.shortTypes[type]}</option>)}
        </select>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 items-start'>
        <div className={cn('bg-card border border-border rounded-lg overflow-hidden', { 'max-lg:hidden': requestId })}>
          {data.requests.length === 0 && <p className='p-4 text-muted-foreground'>{t('No requests.')}</p>}
          {data.requests.map(r => (
            <button
              key={r.id}
              type='button'
              onClick={() => navigate(`${HELP_DESK_URL}/${r.id}`)}
              aria-current={String(r.id) === String(requestId) ? 'true' : undefined}
              className={cn('w-full text-left px-4 py-3 flex items-start justify-between gap-3 border-b border-border last:border-b-0 hover:bg-selected/40', { 'bg-selected/60': String(r.id) === String(requestId) })}
            >
              <span className='min-w-0'>
                <span className={cn('block text-foreground break-words', r.unread ? 'font-bold' : 'font-semibold')}>{r.title}</span>
                <span className='block text-xs text-muted-foreground'>{r.user_name || t('Someone')} · {labels.shortTypes[r.type]} · {formatMoment(r.updated_at)}</span>
              </span>
              <span className='shrink-0 flex flex-col items-end gap-1 text-xs'>
                <span className='rounded-full border border-foreground/20 px-2 py-0.5'>{labels.statuses[r.status]}</span>
                {r.urgency === 'urgent' && <span className='text-destructive font-semibold'>{t('Urgent')}</span>}
              </span>
            </button>
          ))}
        </div>
        <div className={cn('bg-card border border-border rounded-lg p-4', { 'max-lg:hidden': !requestId })}>
          {!requestId && <p className='text-muted-foreground'>{t('Choose a request.')}</p>}
          {requestId && (
            <>
              <button type='button' className='lg:hidden mb-3 text-sm underline' onClick={() => navigate(HELP_DESK_URL)}>{t('Back to the list')}</button>
              <Detail id={requestId} labels={labels} onChanged={load} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
