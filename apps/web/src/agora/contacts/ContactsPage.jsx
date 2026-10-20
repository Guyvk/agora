/**
 * Agora: the shared Contacts page, a small CRM for the people and organisations
 * 7BP works with, team members and people outside Agora. Every Agora member can read, add, change and
 * delete contacts; the server logs who changed which fields.
 *
 *   /contacts             the list
 *   /contacts/new         a new contact
 *   /contacts/<id>        one contact
 *   /contacts?mine=1      my follow-ups
 *
 * The data comes from the server part, see apps/backend/lib/agora/contacts.js.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BookUser, Plus, Trash2 } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import Checkbox from 'components/ui/checkbox'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { contactsApi, today } from './api'

export const CONTACT_FIELDS = [
  'name', 'organisation', 'kind', 'email', 'phone', 'website', 'status', 'circle_id',
  'source', 'consent', 'follow_up_on', 'follow_up_what', 'follow_up_owner_id'
]

const fieldClasses = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function useLabels (t) {
  return useMemo(() => ({
    kinds: { partner: t('Partner'), press: t('Press'), funder: t('Funder'), interested: t('Interested'), other: t('Other') },
    statuses: { new: t('New'), in_touch: t('In touch'), active: t('Active'), paused: t('Paused') },
    fields: {
      name: t('name'),
      organisation: t('organisation'),
      kind: t('kind'),
      email: t('email'),
      phone: t('phone'),
      website: t('website'),
      status: t('status'),
      circle_id: t('circle'),
      source: t('source'),
      consent: t('consent'),
      follow_up_on: t('next step date'),
      follow_up_what: t('next step'),
      follow_up_owner_id: t('who does the next step')
    }
  }), [t])
}

function formatDay (day) {
  return day ? new Date(day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

function formatMoment (iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

function Select ({ value, onChange, children, ...props }) {
  return (
    <select className={fieldClasses} value={value || ''} onChange={e => onChange(e.target.value)} {...props}>
      {children}
    </select>
  )
}

function Field ({ label, htmlFor, className, children }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className='text-muted-foreground'>{label}</Label>
      {children}
    </div>
  )
}

function ContactRow ({ contact, selected, onOpen, labels }) {
  const due = contact.follow_up_on && contact.follow_up_on <= today()
  return (
    <button
      type='button'
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      className={cn('w-full text-left px-4 py-3 flex items-start justify-between gap-3 border-b border-border last:border-b-0 transition-colors hover:bg-selected/40', { 'bg-selected/60': selected })}
    >
      <div className='min-w-0'>
        <div className='font-semibold text-foreground break-words'>{contact.name}</div>
        {contact.organisation && <div className='text-sm text-muted-foreground break-words'>{contact.organisation}</div>}
        <div className='mt-1 flex flex-wrap items-center gap-1.5 text-xs'>
          <span className='rounded-full border border-foreground/20 px-2 py-0.5 text-foreground/80'>{labels.kinds[contact.kind] || contact.kind}</span>
          <span className='rounded-full border border-foreground/20 px-2 py-0.5 text-foreground/80'>{labels.statuses[contact.status] || contact.status}</span>
          {contact.circle_name && <span className='text-muted-foreground'>{contact.circle_name}</span>}
        </div>
      </div>
      {contact.follow_up_on && (
        <div className='shrink-0 text-right text-sm'>
          <div className={cn(due ? 'font-semibold text-destructive' : 'text-foreground')}>{formatDay(contact.follow_up_on)}</div>
          {contact.follow_up_owner_name && <div className='text-xs text-muted-foreground'>{contact.follow_up_owner_name}</div>}
        </div>
      )}
    </button>
  )
}

function emptyContact () {
  return { kind: 'partner', status: 'new', consent: false }
}

function ContactForm ({ contact, meta, labels, onSaved, onDeleted, onCancel }) {
  const { t } = useTranslation()
  const [values, setValues] = useState(() => ({ ...emptyContact(), ...(contact || {}) }))
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState(null)
  const isNew = !contact || !contact.id

  useEffect(() => {
    setValues({ ...emptyContact(), ...(contact || {}) })
    setError(null)
    setSaved(false)
    setConfirmDelete(false)
  }, [contact])

  const set = (name) => (value) => { setSaved(false); setValues(v => ({ ...v, [name]: value })) }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {}
      for (const f of CONTACT_FIELDS) body[f] = values[f] == null ? '' : values[f]
      body.consent = !!values.consent
      const { id } = await contactsApi(isNew ? '/create' : `/${contact.id}/update`, body)
      setSaved(true)
      onSaved(id)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const addNote = async () => {
    setNoteError(null)
    try {
      await contactsApi(`/${contact.id}/notes`, { body: note })
      setNote('')
      onSaved(contact.id)
    } catch (e) {
      setNoteError(e.message)
    }
  }

  const remove = async () => {
    try {
      await contactsApi(`/${contact.id}/delete`, {})
      onDeleted()
    } catch (e) {
      setError(e.message)
    }
  }

  const changeText = (h) => {
    const fields = Array.isArray(h.fields) ? h.fields.map(f => labels.fields[f] || f).join(', ') : ''
    const who = h.user_name || t('Someone')
    if (h.action === 'created') return t('{{who}} added this contact', { who })
    if (h.action === 'updated') return t('{{who}} changed {{fields}}', { who, fields })
    if (h.action === 'note') return t('{{who}} added a note', { who })
    return `${who}: ${h.action}`
  }

  return (
    <form onSubmit={save} noValidate className='flex flex-col gap-4'>
      <h2 className='text-xl font-bold text-foreground break-words'>{isNew ? t('New contact') : contact.name}</h2>

      <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
        <Field label={t('Name')} htmlFor='contact-name' className='sm:col-span-2'>
          <Input id='contact-name' value={values.name || ''} onChange={e => set('name')(e.target.value)} maxLength={255} required autoFocus={isNew} />
        </Field>
        <Field label={t('Organisation')} htmlFor='contact-organisation'>
          <Input id='contact-organisation' value={values.organisation || ''} onChange={e => set('organisation')(e.target.value)} maxLength={255} />
        </Field>
        <Field label={t('Kind')} htmlFor='contact-kind'>
          <Select id='contact-kind' value={values.kind} onChange={set('kind')}>
            {meta.kinds.map(k => <option key={k} value={k}>{labels.kinds[k] || k}</option>)}
          </Select>
        </Field>
        <Field label={t('Email')} htmlFor='contact-email'>
          <Input id='contact-email' type='email' value={values.email || ''} onChange={e => set('email')(e.target.value)} maxLength={255} />
        </Field>
        <Field label={t('Phone')} htmlFor='contact-phone'>
          <Input id='contact-phone' value={values.phone || ''} onChange={e => set('phone')(e.target.value)} maxLength={50} />
        </Field>
        <Field label={t('Website')} htmlFor='contact-website'>
          <Input id='contact-website' value={values.website || ''} onChange={e => set('website')(e.target.value)} maxLength={255} />
        </Field>
        <Field label={t('Status')} htmlFor='contact-status'>
          <Select id='contact-status' value={values.status} onChange={set('status')}>
            {meta.statuses.map(s => <option key={s} value={s}>{labels.statuses[s] || s}</option>)}
          </Select>
        </Field>
        <Field label={t('Circle that mainly deals with them')} htmlFor='contact-circle' className='sm:col-span-2'>
          <Select id='contact-circle' value={values.circle_id} onChange={set('circle_id')}>
            <option value=''>{t('No circle')}</option>
            {meta.circles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('Where the details came from')} htmlFor='contact-source' className='sm:col-span-2'>
          <Input id='contact-source' value={values.source || ''} onChange={e => set('source')(e.target.value)} maxLength={2000} placeholder={t('For example: met at the Utrecht event, business card')} />
        </Field>
        <div className='sm:col-span-2 flex items-center gap-2'>
          <Checkbox id='contact-consent' checked={!!values.consent} onCheckedChange={checked => set('consent')(checked === true)} />
          <Label htmlFor='contact-consent' className='text-foreground'>{t('They agreed that 7BP may contact them')}</Label>
        </div>
        <Field label={t('Next step on')} htmlFor='contact-follow-up-on'>
          <Input id='contact-follow-up-on' type='date' value={values.follow_up_on || ''} onChange={e => set('follow_up_on')(e.target.value)} />
        </Field>
        <Field label={t('Who does it')} htmlFor='contact-owner'>
          <Select id='contact-owner' value={values.follow_up_owner_id} onChange={set('follow_up_owner_id')}>
            <option value=''>{t('Nobody yet')}</option>
            {meta.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={t('Next step')} htmlFor='contact-follow-up-what' className='sm:col-span-2'>
          <Input id='contact-follow-up-what' value={values.follow_up_what || ''} onChange={e => set('follow_up_what')(e.target.value)} maxLength={1000} placeholder={t('For example: send the playbook draft')} />
        </Field>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button type='submit' disabled={busy}>{t('Save')}</Button>
        <Button type='button' variant='outline' onClick={onCancel}>{t('Cancel')}</Button>
        {error && <span role='alert' className='text-sm text-destructive'>{error}</span>}
        {saved && !error && <span className='text-sm text-muted-foreground'>{t('Saved.')}</span>}
        {!isNew && !confirmDelete && (
          <Button type='button' variant='ghost' className='ml-auto text-destructive' onClick={() => setConfirmDelete(true)}>
            <Trash2 /> {t('Delete this contact')}
          </Button>
        )}
      </div>
      {confirmDelete && (
        <div className='flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground'>
          <span>{t('This removes the contact and all notes for good. Sure?')}</span>
          <Button type='button' variant='destructive' size='sm' onClick={remove}>{t('Yes, delete')}</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => setConfirmDelete(false)}>{t('Keep')}</Button>
        </div>
      )}

      {!isNew && (
        <section className='flex flex-col gap-2 border-t border-border pt-4'>
          <h3 className='font-semibold text-foreground'>{t('Notes')}</h3>
          <textarea
            className={cn(fieldClasses, 'min-h-[80px] h-auto')}
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={5000}
            placeholder={t('What was said or done')}
            aria-label={t('New note')}
          />
          <div className='flex items-center gap-2'>
            <Button type='button' variant='outline' size='sm' onClick={addNote} disabled={!note.trim()}>{t('Add note')}</Button>
            {noteError && <span role='alert' className='text-sm text-destructive'>{noteError}</span>}
          </div>
          {contact.notes && contact.notes.length
            ? contact.notes.map(n => (
              <div key={n.id} className='border-t border-border pt-2 first:border-t-0'>
                <p className='whitespace-pre-wrap break-words text-foreground'>{n.body}</p>
                <p className='text-xs text-muted-foreground'>{(n.author_name || t('Someone')) + ', ' + formatMoment(n.created_at)}</p>
              </div>
            ))
            : <p className='text-sm text-muted-foreground'>{t('No notes yet.')}</p>}
        </section>
      )}

      {!isNew && contact.changes && contact.changes.length > 0 && (
        <section className='flex flex-col gap-1 border-t border-border pt-4'>
          <h3 className='font-semibold text-foreground'>{t('Changes')}</h3>
          {contact.changes.map((h, i) => (
            <p key={i} className='text-xs text-muted-foreground'>{changeText(h) + ', ' + formatMoment(h.created_at)}</p>
          ))}
        </section>
      )}
    </form>
  )
}

export default function ContactsPage () {
  const { t } = useTranslation()
  const labels = useLabels(t)
  const navigate = useNavigate()
  const { contactId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const mine = searchParams.get('mine') === '1'
  const [meta, setMeta] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [listError, setListError] = useState(null)
  const [pageError, setPageError] = useState(null)
  const [contact, setContact] = useState(null)
  const [filters, setFilters] = useState({ q: '', kind: '', status: '', circle: '' })
  const [dueCount, setDueCount] = useState(0)
  const searchTimer = useRef(null)
  const [query, setQuery] = useState('')

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Contacts'), icon: <BookUser /> })
  }, [setHeaderDetails, t])

  useEffect(() => {
    contactsApi('/meta')
      .then(data => { setMeta(data); setDueCount(data.dueCount || 0) })
      .catch(e => setPageError(e.message))
  }, [])

  const loadList = useCallback(async () => {
    const params = new URLSearchParams()
    if (mine) params.set('mine', '1')
    else {
      if (filters.q.trim()) params.set('q', filters.q.trim())
      if (filters.kind) params.set('kind', filters.kind)
      if (filters.status) params.set('status', filters.status)
      if (filters.circle) params.set('circle', filters.circle)
    }
    try {
      setListError(null)
      setContacts((await contactsApi('/list?' + params)).contacts)
    } catch (e) {
      setListError(e.message)
    }
  }, [mine, filters])

  useEffect(() => { if (meta) loadList() }, [meta, loadList])

  const loadContact = useCallback(async (id) => {
    if (!id || id === 'new') { setContact(null); return }
    try {
      setContact((await contactsApi('/' + encodeURIComponent(id))).contact)
    } catch (e) {
      setContact({ missing: true, message: e.message })
    }
  }, [])

  useEffect(() => { loadContact(contactId) }, [contactId, loadContact])

  const refreshDue = () => contactsApi('/due').then(d => setDueCount(d.count)).catch(() => {})

  const keepSearch = (path) => navigate({ pathname: path, search: searchParams.toString() ? '?' + searchParams.toString() : '' })

  const onSaved = async (id) => {
    if (String(id) !== String(contactId)) keepSearch(`/contacts/${id}`)
    else await loadContact(id)
    loadList()
    refreshDue()
  }

  const onDeleted = () => {
    keepSearch('/contacts')
    loadList()
    refreshDue()
  }

  const setTab = (showMine) => {
    const next = new URLSearchParams(searchParams)
    if (showMine) next.set('mine', '1')
    else next.delete('mine')
    setSearchParams(next)
  }

  const onSearch = (value) => {
    setQuery(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setFilters(f => ({ ...f, q: value })), 250)
  }

  if (pageError) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <div className='text-center py-12 bg-destructive/10 rounded-lg border border-destructive/20'>
          <BookUser className='w-12 h-12 mx-auto mb-4 text-destructive' />
          <p className='text-foreground'>{pageError}</p>
        </div>
      </div>
    )
  }
  if (!meta) return <Loading />

  const editing = contactId === 'new' || (contact && !contact.missing && String(contact.id) === String(contactId))

  return (
    <div className='p-4 w-full max-w-[1200px] mx-auto flex flex-col gap-4'>
      <Helmet>
        <title>{(editing && contact && contact.name ? contact.name + ' | ' : '') + t('Contacts')} | Agora</title>
      </Helmet>
      <div className='rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm text-foreground'>
        {t('Everyone in Agora can see this list. It holds the people 7BP works with: team members as well as people outside Agora. Note only what 7BP needs to work together, say where the details came from, and delete anyone who asks to be removed. Every change is logged with who made it.')}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button variant={mine ? 'outline' : 'selectedOutline'} size='sm' onClick={() => setTab(false)} aria-pressed={!mine}>{t('All contacts')}</Button>
        <Button variant={mine ? 'selectedOutline' : 'outline'} size='sm' onClick={() => setTab(true)} aria-pressed={mine}>
          {t('My follow-ups')}
          {dueCount > 0 && <span className='ml-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground'>{dueCount}</span>}
        </Button>
        <Button size='sm' className='ml-auto' onClick={() => keepSearch('/contacts/new')}><Plus /> {t('New contact')}</Button>
      </div>

      {!mine && (
        <div className='grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2'>
          <Input className='col-span-2 lg:col-span-1' type='search' value={query} onChange={e => onSearch(e.target.value)} placeholder={t('Search name, organisation or email')} aria-label={t('Search contacts')} />
          <Select value={filters.kind} onChange={kind => setFilters(f => ({ ...f, kind }))} aria-label={t('Kind')}>
            <option value=''>{t('Every kind')}</option>
            {meta.kinds.map(k => <option key={k} value={k}>{labels.kinds[k] || k}</option>)}
          </Select>
          <Select value={filters.status} onChange={status => setFilters(f => ({ ...f, status }))} aria-label={t('Status')}>
            <option value=''>{t('Every status')}</option>
            {meta.statuses.map(s => <option key={s} value={s}>{labels.statuses[s] || s}</option>)}
          </Select>
          <Select value={filters.circle} onChange={circle => setFilters(f => ({ ...f, circle }))} aria-label={t('Circle')}>
            <option value=''>{t('Every circle')}</option>
            {meta.circles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button variant='outline' size='sm' className='h-10' onClick={() => { setQuery(''); setFilters({ q: '', kind: '', status: '', circle: '' }) }}>{t('Clear')}</Button>
        </div>
      )}

      <div className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 items-start'>
        <div className={cn('bg-card border border-border rounded-lg overflow-hidden', { 'max-lg:hidden': contactId })}>
          {listError && <p role='alert' className='p-4 text-sm text-destructive'>{listError}</p>}
          {!listError && !contacts && <Loading />}
          {contacts && contacts.length === 0 && (
            <p className='p-4 text-muted-foreground'>{mine ? t('You have no follow-ups.') : t('No contacts found.')}</p>
          )}
          {contacts && contacts.map(c => (
            <ContactRow key={c.id} contact={c} labels={labels} selected={String(c.id) === String(contactId)} onOpen={() => keepSearch(`/contacts/${c.id}`)} />
          ))}
        </div>

        <div className={cn('bg-card border border-border rounded-lg p-4', { 'max-lg:hidden': !contactId })}>
          {!contactId && <p className='text-muted-foreground'>{t('Choose a contact, or add a new one.')}</p>}
          {contactId && contact && contact.missing && <p role='alert' className='text-destructive'>{contact.message}</p>}
          {contactId && !editing && !(contact && contact.missing) && <Loading />}
          {editing && (
            <ContactForm
              contact={contactId === 'new' ? null : contact}
              meta={meta}
              labels={labels}
              onSaved={onSaved}
              onDeleted={onDeleted}
              onCancel={() => keepSearch('/contacts')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
