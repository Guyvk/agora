/**
 * Agora: Help, the button at the bottom right of every page for people who
 * are logged in. It opens a window where someone describes, in their own
 * words, what is wrong or what they wish for. "My requests" shows what they
 * sent and the answers from the Help desk.
 *
 * Without a Claude key on the server this is a plain form. With one, people
 * may chat with Claude instead, after a notice that their messages go to
 * Claude (Anthropic); the plain form is always one click away, and is used
 * whenever Claude cannot answer.
 *
 * The window opens on the Guide (HelpGuide.jsx), the same parts as the
 * guide page; "Still stuck? Tell us" leads to the form or chat. Other pages
 * open the window on a given view with openHelp() from openHelp.js.
 *
 * An address with ?help=<request id> (the link in a reply email) opens that request.
 * The server part is apps/backend/lib/agora/help.js.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, LifeBuoy, Send, X } from 'lucide-react'
import Button from 'components/ui/button'
import { Label } from 'components/ui/label'
import { cn } from 'util/index'
import { helpApi, helpContext, helpLabels, formatMoment, HELP_DESK_URL } from './api'
import HelpGuide from './HelpGuide'
import { OPEN_HELP_EVENT } from './openHelp'

export const fieldClasses = 'flex w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Field ({ label, htmlFor, children }) {
  return (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={htmlFor} className='text-muted-foreground'>{label}</Label>
      {children}
    </div>
  )
}

/** The plain form: type, what happened, what you expected, how urgent. */
export function HelpForm ({ meta, labels, prefill, note, onSent }) {
  const { t } = useTranslation()
  const [values, setValues] = useState({ type: 'fault', urgency: 'normal', what_happened: prefill || '', what_expected: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = name => e => setValues(v => ({ ...v, [name]: e.target.value }))

  useEffect(() => { if (prefill) setValues(v => ({ ...v, what_happened: prefill })) }, [prefill])

  const send = async event => {
    event.preventDefault()
    if (!values.what_happened.trim()) { setError(t('Please describe what happened, or what you wish for.')); return }
    setBusy(true)
    setError(null)
    try {
      const { id } = await helpApi('/create', { ...values, context: helpContext() })
      onSent(id)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const happenedLabel = values.type === 'wish'
    ? t('What do you wish for?')
    : values.type === 'question' ? t('What is your question?') : t('What happened?')

  return (
    <form onSubmit={send} className='flex flex-col gap-3'>
      {note && <p className='rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground'>{note}</p>}
      <Field label={t('What is it about?')} htmlFor='agora-help-type'>
        <select id='agora-help-type' className={cn(fieldClasses, 'h-10')} value={values.type} onChange={set('type')}>
          {meta.types.map(type => <option key={type} value={type}>{labels.types[type] || type}</option>)}
        </select>
      </Field>
      <Field label={happenedLabel} htmlFor='agora-help-happened'>
        <textarea id='agora-help-happened' rows={4} className={fieldClasses} value={values.what_happened} onChange={set('what_happened')} maxLength={5000} placeholder={t('In your own words')} />
      </Field>
      {values.type !== 'question' && (
        <Field label={t('What did you expect?')} htmlFor='agora-help-expected'>
          <textarea id='agora-help-expected' rows={2} className={fieldClasses} value={values.what_expected} onChange={set('what_expected')} maxLength={5000} />
        </Field>
      )}
      <Field label={t('How urgent is it?')} htmlFor='agora-help-urgency'>
        <select id='agora-help-urgency' className={cn(fieldClasses, 'h-10')} value={values.urgency} onChange={set('urgency')}>
          {meta.urgencies.map(u => <option key={u} value={u}>{labels.urgencies[u] || u}</option>)}
        </select>
      </Field>
      <p className='text-xs text-muted-foreground'>{t('We also send the page you are on, your browser, your screen size and the version of Agora, so the team can find the problem.')}</p>
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
      <Button type='submit' disabled={busy}>{busy ? t('Sending...') : t('Send')}</Button>
    </form>
  )
}

function fallbackNote (t, reason) {
  if (reason === 'limit') return t('You sent many chat messages in the last hour, so here is the plain form. What you wrote is filled in.')
  if (reason === 'long') return t('This chat is getting long, so here is the plain form. What you wrote is filled in.')
  return t('Claude could not answer just now, so here is the plain form. What you wrote is filled in.')
}

/** The chat with Claude, used only when the server has a Claude key. */
export function HelpChat ({ onFallback, onUseForm, onOpenRequest }) {
  const { t } = useTranslation()
  const [chatId, setChatId] = useState(null)
  const [lines, setLines] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [filed, setFiled] = useState(null)
  const end = useRef(null)

  useEffect(() => { if (end.current && end.current.scrollIntoView) end.current.scrollIntoView({ block: 'end' }) }, [lines, busy])

  const restart = () => { setChatId(null); setLines([]); setFiled(null); setError(null) }

  const send = async event => {
    event.preventDefault()
    const text = message.trim()
    if (!text || busy) return
    const written = [...lines.filter(l => l.role === 'person').map(l => l.text), text].join('\n\n')
    setLines(ls => [...ls, { role: 'person', text }])
    setMessage('')
    setBusy(true)
    setError(null)
    try {
      const answer = await helpApi('/chat', { chatId, message: text, context: helpContext() })
      if (answer.fallback) { onFallback(written, answer.reason); return }
      setChatId(answer.chatId)
      if (answer.reply) setLines(ls => [...ls, { role: 'claude', text: answer.reply }])
      if (answer.filed) setFiled(answer.filed)
    } catch (e) {
      if (e.status === 404) { restart(); setError(t('This chat has ended. Start a new one.')) } else onFallback(written, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <p className='rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground'>
        {t('Your messages go to Claude (Anthropic) to be answered.')}{' '}
        <button type='button' className='underline font-semibold' onClick={onUseForm}>{t('Use the plain form instead')}</button>
      </p>
      <div className='flex flex-col gap-2 min-h-[120px]' aria-live='polite'>
        {lines.length === 0 && <p className='text-sm text-muted-foreground'>{t('Ask how something works, tell what went wrong, or share a wish. Claude may ask one or two questions and then passes it on to the team.')}</p>}
        {lines.map((line, i) => (
          <div key={i} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words', line.role === 'person' ? 'self-end bg-selected text-foreground' : 'self-start bg-foreground/5 text-foreground')}>
            {line.text}
          </div>
        ))}
        {busy && <div className='self-start text-sm text-muted-foreground'>{t('Claude is writing...')}</div>}
        <div ref={end} />
      </div>
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
      {filed
        ? (
          <div className='flex flex-col gap-2 rounded-md border border-border p-3 text-sm'>
            <p>{t('Sent to the team as a request: {{title}}', { title: filed.title })}</p>
            <div className='flex gap-2'>
              <Button size='sm' variant='outline' onClick={() => onOpenRequest(filed.id)}>{t('See my request')}</Button>
              <Button size='sm' variant='outline' onClick={restart}>{t('Start a new chat')}</Button>
            </div>
          </div>
          )
        : (
          <form onSubmit={send} className='flex gap-2 items-end'>
            <textarea
              aria-label={t('Your message')}
              rows={2}
              className={fieldClasses}
              value={message}
              maxLength={4000}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e) }}
            />
            <Button type='submit' size='sm' disabled={busy || !message.trim()} aria-label={t('Send')}><Send /></Button>
          </form>
          )}
    </div>
  )
}

/** One of my requests, with the answers, and a box to add something. */
export function MyRequest ({ id, labels, onBack, onChanged }) {
  const { t } = useTranslation()
  const [request, setRequest] = useState(null)
  const [error, setError] = useState(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRequest((await helpApi('/mine/' + encodeURIComponent(id))).request)
      onChanged && onChanged()
    } catch (e) {
      setError(e.message)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const send = async event => {
    event.preventDefault()
    if (!reply.trim()) return
    setBusy(true)
    try {
      await helpApi(`/mine/${encodeURIComponent(id)}/reply`, { body: reply })
      setReply('')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <button type='button' onClick={onBack} className='self-start flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'><ArrowLeft className='w-4 h-4' /> {t('My requests')}</button>
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
      {request && (
        <>
          <div>
            <h3 className='font-semibold text-foreground break-words'>{request.title}</h3>
            <p className='text-xs text-muted-foreground'>{labels.shortTypes[request.type]} · {labels.statuses[request.status]} · {formatMoment(request.created_at)}</p>
          </div>
          {request.what_happened && <p className='text-sm whitespace-pre-wrap break-words'>{request.what_happened}</p>}
          {request.what_expected && <p className='text-sm whitespace-pre-wrap break-words'><span className='text-muted-foreground'>{t('What I expected')}: </span>{request.what_expected}</p>}
          {request.summary && <p className='text-sm whitespace-pre-wrap break-words'>{request.summary}</p>}
          {request.conversation && request.conversation.length > 0 && (
            <details className='text-sm'>
              <summary className='cursor-pointer text-muted-foreground'>{t('The chat')}</summary>
              <div className='mt-2 flex flex-col gap-1'>
                {request.conversation.map((m, i) => <p key={i} className='whitespace-pre-wrap break-words'><strong>{m.role === 'claude' ? 'Claude' : t('Me')}:</strong> {m.text}</p>)}
              </div>
            </details>
          )}
          <div className='flex flex-col gap-2'>
            {request.replies.map(r => (
              <div key={r.id} className={cn('rounded-lg px-3 py-2 text-sm', r.from_desk ? 'bg-accent/10 border border-accent/30' : 'bg-foreground/5')}>
                <p className='text-xs text-muted-foreground'>{r.from_desk ? t('Help desk') : t('Me')} · {formatMoment(r.created_at)}</p>
                <p className='whitespace-pre-wrap break-words'>{r.body}</p>
              </div>
            ))}
          </div>
          <form onSubmit={send} className='flex flex-col gap-2'>
            <textarea aria-label={t('Add something')} placeholder={t('Add something')} rows={2} className={fieldClasses} value={reply} maxLength={5000} onChange={e => setReply(e.target.value)} />
            <Button type='submit' size='sm' variant='outline' disabled={busy || !reply.trim()}>{t('Send')}</Button>
          </form>
        </>
      )}
    </div>
  )
}

function MyRequests ({ labels, onOpen }) {
  const { t } = useTranslation()
  const [requests, setRequests] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    helpApi('/mine').then(d => setRequests(d.requests)).catch(e => setError(e.message))
  }, [])

  if (error) return <p role='alert' className='text-sm text-destructive'>{error}</p>
  if (!requests) return <p className='text-sm text-muted-foreground'>{t('Loading...')}</p>
  if (requests.length === 0) return <p className='text-sm text-muted-foreground'>{t('You have not sent any requests yet.')}</p>
  return (
    <ul className='flex flex-col'>
      {requests.map(r => (
        <li key={r.id}>
          <button type='button' onClick={() => onOpen(r.id)} className='w-full text-left py-2 border-b border-border last:border-b-0 hover:bg-selected/40 flex items-start justify-between gap-2'>
            <span className='min-w-0'>
              <span className='block text-sm font-semibold text-foreground break-words'>{r.title}</span>
              <span className='block text-xs text-muted-foreground'>{labels.shortTypes[r.type]} · {formatMoment(r.created_at)}</span>
            </span>
            <span className='shrink-0 flex items-center gap-1 text-xs'>
              {r.unread && <span className='rounded-full bg-destructive px-1.5 text-destructive-foreground'>{t('New answer')}</span>}
              <span className='rounded-full border border-foreground/20 px-2 py-0.5'>{labels.statuses[r.status]}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function requestFromAddress () {
  try {
    const value = new URLSearchParams(window.location.search).get('help')
    return value && /^\d+$/.test(value) ? value : null
  } catch (e) {
    return null
  }
}

export default function HelpWindow () {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const labels = helpLabels(t)
  const [open, setOpen] = useState(false)
  const [meta, setMeta] = useState(null)
  const [tab, setTab] = useState('guide') // guide | new | mine
  const [guidePart, setGuidePart] = useState(null)
  const [mode, setMode] = useState(null) // chat | form | sent
  const [prefill, setPrefill] = useState('')
  const [note, setNote] = useState(null)
  const [requestId, setRequestId] = useState(null)

  const refresh = useCallback(() => {
    helpApi('/status').then(setMeta).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5 * 60 * 1000)
    const fromLink = requestFromAddress()
    if (fromLink) { setOpen(true); setTab('mine'); setRequestId(fromLink) }
    return () => clearInterval(timer)
  }, [refresh])

  // openHelp({ view, part }) from any page opens the window on that view
  useEffect(() => {
    const onOpenHelp = event => {
      const { view, part } = (event && event.detail) || {}
      setOpen(true)
      setRequestId(null)
      if (view === 'new') {
        setTab('new'); setMode(null); setPrefill(''); setNote(null)
      } else if (view === 'mine') {
        setTab('mine')
      } else {
        setTab('guide'); setGuidePart(part || null)
      }
    }
    window.addEventListener(OPEN_HELP_EVENT, onOpenHelp)
    return () => window.removeEventListener(OPEN_HELP_EVENT, onOpenHelp)
  }, [])

  if (!meta) return null

  // Chat rooms and Messages have their send button at the bottom right, so Help sits higher there.
  const raised = /\/(chat|messages)(\/|$)/.test(pathname || '')
  const currentMode = mode || (meta.claude ? 'chat' : 'form')
  const openRequest = id => { setTab('mine'); setRequestId(id) }
  const newRequest = () => { setTab('new'); setMode(null); setPrefill(''); setNote(null) }

  return (
    <>
      {!open && (
        <button
          type='button'
          onClick={() => { setOpen(true); setTab('guide'); setGuidePart(null) }}
          className={cn(
            'fixed right-4 z-[60] flex items-center gap-1.5 rounded-full bg-foreground text-background shadow-lg px-3 py-2 text-sm font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            raised ? 'bottom-28' : 'bottom-20 sm:bottom-4'
          )}
          data-testid='agora-help-button'
        >
          <LifeBuoy className='w-4 h-4' />
          {t('Help')}
          {meta.unread > 0 && <span className='rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground' aria-label={t('{{count}} new answers', { count: meta.unread })}>{meta.unread}</span>}
        </button>
      )}
      {open && (
        <div role='dialog' aria-label={t('Help')} className='fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:w-[400px] max-h-[85vh] flex flex-col rounded-lg border border-border bg-card text-foreground shadow-xl'>
          <div className='flex items-center gap-2 border-b border-border px-4 py-3'>
            <LifeBuoy className='w-5 h-5' />
            <h2 className='font-semibold text-base m-0'>{t('Help')}</h2>
            <button type='button' className='ml-auto text-muted-foreground hover:text-foreground' onClick={() => setOpen(false)} aria-label={t('Close')}><X className='w-5 h-5' /></button>
          </div>
          <div className='flex flex-wrap items-center gap-2 px-4 pt-3'>
            <Button size='sm' variant={tab === 'guide' ? 'selectedOutline' : 'outline'} aria-pressed={tab === 'guide'} onClick={() => { setTab('guide'); setGuidePart(null) }}><BookOpen className='w-4 h-4' /> {t('Guide')}</Button>
            <Button size='sm' variant={tab === 'new' ? 'selectedOutline' : 'outline'} aria-pressed={tab === 'new'} onClick={newRequest}>{t('New request')}</Button>
            <Button size='sm' variant={tab === 'mine' ? 'selectedOutline' : 'outline'} aria-pressed={tab === 'mine'} onClick={() => { setTab('mine'); setRequestId(null) }}>
              {t('My requests')}
              {meta.unread > 0 && <span className='ml-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground'>{meta.unread}</span>}
            </Button>
            {meta.isAdmin && (
              <button type='button' className='ml-auto text-sm underline text-muted-foreground hover:text-foreground' onClick={() => { setOpen(false); navigate(HELP_DESK_URL) }}>{t('Help desk')}</button>
            )}
          </div>
          <div className='overflow-y-auto px-4 py-3'>
            {tab === 'guide' && <HelpGuide part={guidePart} onPart={setGuidePart} onAsk={newRequest} onNavigate={() => setOpen(false)} />}
            {tab === 'new' && currentMode === 'sent' && (
              <div className='flex flex-col gap-3'>
                <p className='text-sm'>{t('Thank you. Your request is with the team. You will find their answers under My requests.')}</p>
                <Button size='sm' variant='outline' onClick={newRequest}>{t('Send another request')}</Button>
              </div>
            )}
            {tab === 'new' && currentMode === 'chat' && (
              <HelpChat
                onUseForm={() => { setNote(null); setMode('form') }}
                onFallback={(written, reason) => { setPrefill(written); setNote(fallbackNote(t, reason)); setMode('form') }}
                onOpenRequest={id => { refresh(); openRequest(id) }}
              />
            )}
            {tab === 'new' && currentMode === 'form' && (
              <HelpForm meta={meta} labels={labels} prefill={prefill} note={note} onSent={() => { setMode('sent'); refresh() }} />
            )}
            {tab === 'mine' && !requestId && <MyRequests labels={labels} onOpen={setRequestId} />}
            {tab === 'mine' && requestId && <MyRequest id={requestId} labels={labels} onBack={() => setRequestId(null)} onChanged={refresh} />}
          </div>
        </div>
      )}
    </>
  )
}
